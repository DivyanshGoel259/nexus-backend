import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { verifyToken } from './helpers/tokenUtils';
import { isTokenBlacklisted } from './helpers/tokenUtils';
import * as seatService from '../seats/service';
import * as eventService from '../events/service';
import * as bookingService from '../bookings/service';
import { getCachedSeatAvailability, invalidateEventAvailability, invalidateSeatAvailability } from './cache';
import { invalidateEventCache } from './cache/eventCache';

let io: SocketServer | null = null;

/**
 * Initialize Socket.IO server with WebSocket handlers
 */
export const initializeSocket = (httpServer: HttpServer) => {
  io = new SocketServer(httpServer, {
    cors: {
      origin: "*", // Configure this based on your frontend URL
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  // Authentication middleware for Socket.IO
  io.use(async (socket: Socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
    
    if (!token) {
      // Allow connection without auth, but mark as unauthenticated
      (socket as any).userId = null;
      return next();
    }

    try {
      // Check if token is blacklisted
      if (await isTokenBlacklisted(token)) {
        (socket as any).userId = null;
        return next();
      }

      // Verify token
      const decoded = verifyToken(token, 'access');
      (socket as any).userId = decoded.userId;
      next();
    } catch (err) {
      // Allow connection but mark as unauthenticated
      (socket as any).userId = null;
      next();
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = (socket as any).userId;
    console.log(`Client connected: ${socket.id}${userId ? ` (User: ${userId})` : ' (Unauthenticated)'}`);

    // ====================================
    // EVENT OPERATIONS (WebSocket)
    // ====================================

    // Create event
    socket.on('create_event', async (data: {
      name: string;
      description: string;
      start_date: string;
      end_date: string;
      image_url?: string;
      location: string;
      venue_name?: string;
      max_tickets_per_user?: number;
      seat_types: Array<{
        name: string;
        description?: string;
        price: number;
        quantity: number;
      }>;
    }) => {
      try {
        if (!userId) {
          socket.emit('error', { message: 'Authentication required' });
          return;
        }

        const eventData = {
          ...data,
          organizer_id: userId,
        };

        const result = await eventService.createEvent(eventData);

        // ⚡ Event list cache already invalidated inside createEvent service

        // Broadcast to all clients EXCEPT requester (organizer)
        socket.broadcast.emit('event_created', {
          event: result.event,
          seat_types: result.seat_types,
          total_seats_available: result.total_seats_available,
        });
        console.log(`[BROADCAST] event_created to all clients except ${socket.id}`);

        // Send response only to requester (organizer)
        socket.emit('create_event_response', { success: true, data: result });
      } catch (error: any) {
        socket.emit('create_event_response', { success: false, error: error.message });
      }
    });

    // Update event
    socket.on('update_event', async (data: {
      eventId: number;
      name?: string;
      description?: string;
      start_date?: string;
      end_date?: string;
      image_url?: string;
      location?: string;
      venue_name?: string;
      status?: string;
      is_public?: boolean;
      max_tickets_per_user?: number;
    }) => {
      try {
        if (!userId) {
          socket.emit('error', { message: 'Authentication required' });
          return;
        }

        const result = await eventService.updateEvent(data.eventId, data, userId);

        // ⚡ Event cache already invalidated inside updateEvent service

        // Broadcast to all clients EXCEPT requester (organizer)
        socket.broadcast.emit('event_updated', {
          event: result.event,
        });
        console.log(`[BROADCAST] event_updated to all clients except ${socket.id}`);

        // Send response only to requester (organizer)
        socket.emit('update_event_response', { success: true, data: result });
      } catch (error: any) {
        socket.emit('update_event_response', { success: false, error: error.message });
      }
    });

    // Delete event
    socket.on('delete_event', async (data: { eventId: number }) => {
      try {
        if (!userId) {
          socket.emit('error', { message: 'Authentication required' });
          return;
        }

        const result = await eventService.deleteEvent(data.eventId, userId);

        // ⚡ Event cache already invalidated inside deleteEvent service

        // Broadcast to all clients EXCEPT requester (organizer)
        socket.broadcast.emit('event_deleted', {
          deleted_event_id: result.deleted_event_id,
          message: result.message,
        });
        console.log(`[BROADCAST] event_deleted to all clients except ${socket.id}`);

        // Send response only to requester (organizer)
        socket.emit('delete_event_response', { success: true, data: result });
      } catch (error: any) {
        socket.emit('delete_event_response', { success: false, error: error.message });
      }
    });

    // ====================================
    // SEAT TYPE OPERATIONS (WebSocket)
    // ====================================

    // Create seat type
    socket.on('create_seat_type', async (data: { eventId: number; name: string; description?: string; price: number; quantity: number }) => {
      try {
        if (!userId) {
          socket.emit('error', { message: 'Authentication required' });
          return;
        }

        const result = await seatService.createSeatType(
          data.eventId,
          {
            name: data.name,
            description: data.description,
            price: data.price,
            quantity: data.quantity
          },
          userId
        );

        // ⚡ Invalidate caches (new seat type changes availability)
        await invalidateEventAvailability(data.eventId);
        await invalidateEventCache(data.eventId);

        // Broadcast to all clients EXCEPT requester
        socket.broadcast.emit('seat_type_created', {
          event_id: data.eventId,
          seat_type: result.seat_type
        });
        console.log(`[BROADCAST] seat_type_created to all clients except ${socket.id}`);

        // Send response only to requester
        socket.emit('create_seat_type_response', { success: true, data: result });
      } catch (error: any) {
        socket.emit('create_seat_type_response', { success: false, error: error.message });
      }
    });

    // Update seat type
    socket.on('update_seat_type', async (data: { eventId: number; seatTypeId: number; name?: string; description?: string; price?: number; quantity?: number }) => {
      try {
        if (!userId) {
          socket.emit('error', { message: 'Authentication required' });
          return;
        }

        const result = await seatService.updateSeatType(
          data.eventId,
          data.seatTypeId,
          {
            name: data.name,
            description: data.description,
            price: data.price,
            quantity: data.quantity
          },
          userId
        );

        // ⚡ Invalidate caches (seat type updated, availability may change)
        await invalidateSeatAvailability(data.eventId, data.seatTypeId);
        await invalidateEventCache(data.eventId);

        // Broadcast to all clients EXCEPT requester
        socket.broadcast.emit('seat_type_updated', {
          event_id: data.eventId,
          seat_type: result.seat_type
        });
        console.log(`[BROADCAST] seat_type_updated to all clients except ${socket.id}`);

        // Send response only to requester
        socket.emit('update_seat_type_response', { success: true, data: result });
      } catch (error: any) {
        socket.emit('update_seat_type_response', { success: false, error: error.message });
      }
    });

    // Delete seat type
    socket.on('delete_seat_type', async (data: { eventId: number; seatTypeId: number }) => {
      try {
        if (!userId) {
          socket.emit('error', { message: 'Authentication required' });
          return;
        }

        const result = await seatService.deleteSeatType(
          data.eventId,
          data.seatTypeId,
          userId
        );

        // ⚡ Invalidate caches (seat type deleted)
        await invalidateSeatAvailability(data.eventId, data.seatTypeId);
        await invalidateEventAvailability(data.eventId);
        await invalidateEventCache(data.eventId);

        // Broadcast to all clients EXCEPT requester
        socket.broadcast.emit('seat_type_deleted', {
          event_id: data.eventId,
          seat_type_id: data.seatTypeId,
          seat_type_name: result.message
        });
        console.log(`[BROADCAST] seat_type_deleted to all clients except ${socket.id}`);

        // Send response only to requester
        socket.emit('delete_seat_type_response', { success: true, data: result });
      } catch (error: any) {
        socket.emit('delete_seat_type_response', { success: false, error: error.message });
      }
    });

    // Lock seat
    socket.on('lock_seat', async (data: { eventId: number; seatTypeId: number; seat_label: string }) => {
      try {
        if (!userId) {
          socket.emit('error', { message: 'Authentication required' });
          return;
        }

        const result = await seatService.lockSeat(
          data.eventId,
          data.seatTypeId,
          userId,
          data.seat_label
        );

        // ⚡ Get updated available quantity from Redis cache (fast path)
        const availableQuantity = await getCachedSeatAvailability(data.eventId, data.seatTypeId) ?? 0;

        // Broadcast to all clients EXCEPT requester
        socket.broadcast.emit('seat_locked', {
          event_id: data.eventId,
          seat_type_id: data.seatTypeId,
          seat_label: result.lock.seat_label,
          user_id: userId,
          available_quantity: availableQuantity,
          lock: result.lock
        });
        console.log(`[BROADCAST] seat_locked to all clients except ${socket.id}`, {
          event_id: data.eventId,
          seat_label: result.lock.seat_label
        });

        // Send response only to requester
        socket.emit('lock_seat_response', { success: true, data: result });
        console.log(`[RESPONSE] lock_seat_response sent to requester ${socket.id}`);
      } catch (error: any) {
        socket.emit('lock_seat_response', { success: false, error: error.message });
      }
    });

    // ====================================
    // BOOKING OPERATIONS (WebSocket)
    // ====================================

    // Create booking
    socket.on('create_booking', async (data: {
      event_id: number;
      seat_details: Array<{
        seat_label: string;
        seat_type_id: number;
      }>;
    }) => {
      try {
        if (!userId) {
          socket.emit('error', { message: 'Authentication required' });
          return;
        }

        const result = await bookingService.createBooking(
          data.event_id,
          userId,
          data.seat_details
        );

        // Broadcast to all clients EXCEPT requester
        socket.broadcast.emit('booking_created', {
          event_id: result.booking.event_id,
          booking_reference: result.booking.booking_reference,
          total_amount: result.booking.total_amount,
          status: result.booking.status,
        });
        console.log(`[BROADCAST] booking_created to all clients except ${socket.id}`);

        // Send response only to requester
        socket.emit('create_booking_response', { success: true, data: result });
      } catch (error: any) {
        socket.emit('create_booking_response', { success: false, error: error.message });
      }
    });

    // Confirm booking (after payment)
    socket.on('confirm_booking', async (data: {
      booking_id: number;
      payment_id: string;
      payment_gateway?: string;
    }) => {
      try {
        if (!userId) {
          socket.emit('error', { message: 'Authentication required' });
          return;
        }

        const result = await bookingService.confirmBooking(
          data.booking_id,
          data.payment_id,
          data.payment_gateway || 'razorpay'
        );

        // Broadcast to all clients EXCEPT requester
        socket.broadcast.emit('booking_confirmed', {
          event_id: result.booking.event_id,
          booking_reference: result.booking.booking_reference,
          total_tickets: result.total_tickets,
          status: result.booking.status,
        });
        console.log(`[BROADCAST] booking_confirmed to all clients except ${socket.id}`);

        // Send response only to requester
        socket.emit('confirm_booking_response', { success: true, data: result });
      } catch (error: any) {
        socket.emit('confirm_booking_response', { success: false, error: error.message });
      }
    });

    // Cancel booking
    socket.on('cancel_booking', async (data: {
      booking_id: number;
      reason?: string;
    }) => {
      try {
        if (!userId) {
          socket.emit('error', { message: 'Authentication required' });
          return;
        }

        const result = await bookingService.cancelBooking(
          data.booking_id,
          userId,
          data.reason
        );

        // Broadcast to all clients EXCEPT requester
        socket.broadcast.emit('booking_cancelled', {
          booking_id: data.booking_id,
          reason: data.reason || 'Cancelled by user',
        });
        console.log(`[BROADCAST] booking_cancelled to all clients except ${socket.id}`);

        // Send response only to requester
        socket.emit('cancel_booking_response', { success: true, data: result });
      } catch (error: any) {
        socket.emit('cancel_booking_response', { success: false, error: error.message });
      }
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });

  return io;
};

/**
 * Get Socket.IO instance
 */
export const getIO = (): SocketServer => {
  if (!io) {
    throw new Error('Socket.IO not initialized. Call initializeSocket first.');
  }
  return io;
};

/**
 * Emit event to all clients in an event room
 */
export const emitToEvent = (eventId: number, eventName: string, data: any) => {
  try {
    const socketIO = getIO();
    socketIO.to(`event:${eventId}`).emit(eventName, data);
    console.log(`Emitted ${eventName} to event:${eventId}`, data);
  } catch (error) {
    console.error(`Failed to emit ${eventName} to event:${eventId}:`, error);
    // Don't throw - socket errors shouldn't break the API
  }
};

/**
 * Emit event to all connected clients (broadcast)
 */
export const emitToAll = (eventName: string, data: any) => {
  try {
    const socketIO = getIO();
    socketIO.emit(eventName, data);
    console.log(`Broadcasted ${eventName} to all clients`, data);
  } catch (error) {
    console.error(`Failed to broadcast ${eventName}:`, error);
    // Don't throw - socket errors shouldn't break the API
  }
};


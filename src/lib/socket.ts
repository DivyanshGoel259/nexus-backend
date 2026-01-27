import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { verifyToken } from './helpers/tokenUtils';
import { isTokenBlacklisted } from './helpers/tokenUtils';
import * as seatService from '../seats/service';
import db from '../lib/db';

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

        // Get updated available quantity from database
        const seatType = await db.oneOrNone(
          `SELECT available_quantity FROM event_seat_types WHERE id = $1`,
          [data.seatTypeId]
        );

        const availableQuantity = seatType ? parseInt(seatType.available_quantity) : 0;

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


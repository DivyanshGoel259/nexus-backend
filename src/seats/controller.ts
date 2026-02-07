import { Request, Response, NextFunction } from "express";
import * as service from "./service";
import { emitToAll } from "../lib/socket";
import { getCachedSeatAvailability, invalidateSeatAvailability, invalidateEventAvailability } from "../lib/cache";
import { invalidateEventCache } from "../lib/cache/eventCache";

export const lockSeat = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = (req as any).userId;

    if (!userId) {
      throw new Error("User ID not found. Please authenticate first.");
    }

    const eventId = parseInt(req.params.eventId as string);
    const seatTypeId = parseInt(req.params.seatTypeId as string);
    const { seat_label } = req.body;

    if (!eventId || isNaN(eventId)) {
      throw new Error("Invalid event ID");
    }

    if (!seatTypeId || isNaN(seatTypeId)) {
      throw new Error("Invalid seat type ID");
    }

    if (!seat_label) {
      throw new Error("Seat label is required in request body");
    }

    const data = await service.lockSeat(eventId, seatTypeId, userId, seat_label);
    
    // ⚡ Get updated available quantity from Redis cache (fast path)
    const availableQuantity = await getCachedSeatAvailability(eventId, seatTypeId) ?? 0;
    
    // Broadcast to all clients (HTTP route - no requester to exclude)
    emitToAll('seat_locked', {
      event_id: eventId,
      seat_type_id: seatTypeId,
      seat_label: data.lock.seat_label,
      user_id: userId,
      available_quantity: availableQuantity,
      lock: data.lock
    });
    
    return res.json({ data });
  } catch (err: any) {
    next(err);
  }
};

export const createSeatType = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = (req as any).userId;

    if (!userId) {
      throw new Error("User ID not found. Please authenticate first.");
    }

    const eventId = parseInt(req.params.eventId as string);

    if (!eventId || isNaN(eventId)) {
      throw new Error("Invalid event ID");
    }

    const data = await service.createSeatType(eventId, req.body, userId);
    
    // ⚡ Invalidate seat availability & event cache (new seat type added)
    await invalidateEventAvailability(eventId);
    await invalidateEventCache(eventId);

    // Broadcast to all clients (HTTP route - no requester to exclude)
    emitToAll('seat_type_created', {
      event_id: eventId,
      seat_type: data.seat_type
    });
    
    return res.json({ data });
  } catch (err: any) {
    next(err);
  }
};

export const updateSeatType = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = (req as any).userId;

    if (!userId) {
      throw new Error("User ID not found. Please authenticate first.");
    }

    const eventId = parseInt(req.params.eventId as string);
    const seatTypeId = parseInt(req.params.seatTypeId as string);

    if (!eventId || isNaN(eventId)) {
      throw new Error("Invalid event ID");
    }

    if (!seatTypeId || isNaN(seatTypeId)) {
      throw new Error("Invalid seat type ID");
    }

    const data = await service.updateSeatType(eventId, seatTypeId, req.body, userId);
    
    // ⚡ Invalidate caches (seat type data changed)
    await invalidateSeatAvailability(eventId, seatTypeId);
    await invalidateEventCache(eventId);

    // Broadcast to all clients (HTTP route - no requester to exclude)
    emitToAll('seat_type_updated', {
      event_id: eventId,
      seat_type: data.seat_type
    });
    
    return res.json({ data });
  } catch (err: any) {
    next(err);
  }
};

export const deleteSeatType = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = (req as any).userId;

    if (!userId) {
      throw new Error("User ID not found. Please authenticate first.");
    }

    const eventId = parseInt(req.params.eventId as string);
    const seatTypeId = parseInt(req.params.seatTypeId as string);

    if (!eventId || isNaN(eventId)) {
      throw new Error("Invalid event ID");
    }

    if (!seatTypeId || isNaN(seatTypeId)) {
      throw new Error("Invalid seat type ID");
    }

    const data = await service.deleteSeatType(eventId, seatTypeId, userId);
    
    // ⚡ Invalidate caches (seat type deleted)
    await invalidateSeatAvailability(eventId, seatTypeId);
    await invalidateEventAvailability(eventId);
    await invalidateEventCache(eventId);

    // Broadcast to all clients (HTTP route - no requester to exclude)
    emitToAll('seat_type_deleted', {
      event_id: eventId,
      seat_type_id: seatTypeId,
      seat_type_name: data.message
    });
    
    return res.json({ data });
  } catch (err: any) {
    next(err);
  }
};


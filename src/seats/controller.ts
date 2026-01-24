import { Request, Response, NextFunction } from "express";
import * as service from "./service";

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
    return res.json({ data });
  } catch (err: any) {
    next(err);
  }
};


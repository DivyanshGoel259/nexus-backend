import { Request, Response, NextFunction } from "express";

import * as service from "./service";

export const createEvent = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get user ID from middleware (set by authMiddleware)
    const userId = (req as any).userId;
    
    if (!userId) {
      throw new Error("User ID not found. Please authenticate first.");
    }

    // Add organizer_id from middleware to request body
    const eventData = {
      ...req.body,
      organizer_id: userId,
    };

    const data = await service.createEvent(eventData);
    return res.json({ data });
  } catch (err: any) {
    next(err);
  }
};

export const getAllEvents = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const options: any = {};

    // Optional filters from query params
    if (req.query.status) {
      options.status = req.query.status as string;
    }
    if (req.query.is_public !== undefined) {
      options.is_public = req.query.is_public === "true";
    }
    if (req.query.organizer_id) {
      options.organizer_id = parseInt(req.query.organizer_id as string);
    }

    // Pagination params
    if (req.query.limit) {
      options.limit = parseInt(req.query.limit as string);
    }
    if (req.query.offset) {
      options.offset = parseInt(req.query.offset as string);
    }

    const result = await service.getAllEvents(options);
    return res.json({ data: result.events, pagination: result.pagination });
  } catch (err: any) {
    next(err);
  }
};

export const getEventById = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const eventId = parseInt(req.params.id as string);

    if (!eventId || isNaN(eventId)) {
      throw new Error("Invalid event ID");
    }

    const event = await service.getEventById(eventId);
    return res.json({ data: event });
  } catch (err: any) {
    next(err);
  }
};

export const updateEvent = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = (req as any).userId;
    
    if (!userId) {
      throw new Error("User ID not found. Please authenticate first.");
    }

    const eventId = parseInt(req.params.id as string);

    if (!eventId || isNaN(eventId)) {
      throw new Error("Invalid event ID");
    }

    const data = await service.updateEvent(eventId, req.body, userId);
    return res.json({ data });
  } catch (err: any) {
    next(err);
  }
};

export const deleteEvent = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = (req as any).userId;
    
    if (!userId) {
      throw new Error("User ID not found. Please authenticate first.");
    }

    const eventId = parseInt(req.params.id as string);

    if (!eventId || isNaN(eventId)) {
      throw new Error("Invalid event ID");
    }

    const data = await service.deleteEvent(eventId, userId);
    return res.json({ data });
  } catch (err: any) {
    next(err);
  }
};


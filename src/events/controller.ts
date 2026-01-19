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


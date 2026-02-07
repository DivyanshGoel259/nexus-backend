import { Request, Response, NextFunction } from "express";
import * as service from "./service";
import { emitToAll } from "../lib/socket";
import { getTicketJobStatus } from "../lib/jobs/ticketQueue";

/**
 * Create booking from locked seats
 * POST /api/v1/bookings/create
 */
export const createBooking = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = (req as any).userId;

    if (!userId) {
      throw new Error("User ID not found. Please authenticate first.");
    }

    const { event_id, seat_details } = req.body;

    if (!event_id) {
      throw new Error("Event ID is required");
    }

    if (!seat_details || !Array.isArray(seat_details) || seat_details.length === 0) {
      throw new Error("At least one seat detail is required");
    }

    // Validate seat details structure
    for (const seat of seat_details) {
      if (!seat.seat_label || !seat.seat_type_id) {
        throw new Error("Each seat detail must have seat_label and seat_type_id");
      }
    }

    const data = await service.createBooking(
      parseInt(event_id),
      parseInt(userId),
      seat_details
    );

    // Broadcast booking created (all clients)
    emitToAll('booking_created', {
      event_id: data.booking.event_id,
      booking_reference: data.booking.booking_reference,
      total_amount: data.booking.total_amount,
      status: data.booking.status,
    });

    return res.json({
      success: true,
      data,
    });
  } catch (err: any) {
    next(err);
  }
};

/**
 * Confirm booking after payment
 * POST /api/v1/bookings/:id/confirm
 */
export const confirmBooking = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const bookingId = parseInt(req.params.id as string);

    if (!bookingId || isNaN(bookingId)) {
      throw new Error("Invalid booking ID");
    }

    const { payment_id, payment_gateway } = req.body;

    if (!payment_id) {
      throw new Error("Payment ID is required");
    }

    const data = await service.confirmBooking(
      bookingId,
      payment_id,
      payment_gateway || "razorpay"
    );

    // Broadcast booking confirmed (all clients)
    emitToAll('booking_confirmed', {
      event_id: data.booking.event_id,
      booking_reference: data.booking.booking_reference,
      total_tickets: data.total_tickets,
      status: data.booking.status,
    });

    return res.json({
      success: true,
      data,
    });
  } catch (err: any) {
    next(err);
  }
};

/**
 * Get booking by ID
 * GET /api/v1/bookings/:id
 */
export const getBookingById = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const bookingId = parseInt(req.params.id as string);

    if (!bookingId || isNaN(bookingId)) {
      throw new Error("Invalid booking ID");
    }

    const userId = (req as any).userId; // Optional - if provided, verify ownership

    const data = await service.getBookingById(bookingId, userId ? parseInt(userId) : undefined);

    return res.json({
      success: true,
      data,
    });
  } catch (err: any) {
    next(err);
  }
};

/**
 * Get all bookings for authenticated user
 * GET /api/v1/bookings/my-bookings
 */
export const getMyBookings = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = (req as any).userId;

    if (!userId) {
      throw new Error("User ID not found. Please authenticate first.");
    }

    const options: any = {};

    // Optional filters from query params
    if (req.query.status) {
      options.status = req.query.status as string;
    }
    if (req.query.limit) {
      options.limit = parseInt(req.query.limit as string);
    }
    if (req.query.offset) {
      options.offset = parseInt(req.query.offset as string);
    }

    const data = await service.getBookingsByUser(parseInt(userId), options);

    return res.json({
      success: true,
      data: data.bookings,
      pagination: data.pagination,
    });
  } catch (err: any) {
    next(err);
  }
};

/**
 * Cancel booking
 * POST /api/v1/bookings/:id/cancel
 */
export const cancelBooking = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = (req as any).userId;

    if (!userId) {
      throw new Error("User ID not found. Please authenticate first.");
    }

    const bookingId = parseInt(req.params.id as string);

    if (!bookingId || isNaN(bookingId)) {
      throw new Error("Invalid booking ID");
    }

    const { reason, idempotency_key } = req.body;

    const data = await service.cancelBooking(
      bookingId,
      parseInt(userId),
      reason,
      idempotency_key
    );

    // Broadcast booking cancelled (all clients)
    emitToAll('booking_cancelled', {
      booking_id: bookingId,
      reason: reason || "Cancelled by user",
    });

    return res.json({
      success: true,
      data,
    });
  } catch (err: any) {
    next(err);
  }
};

/**
 * Get tickets for a booking (poll for async-generated tickets)
 * GET /api/v1/bookings/:id/tickets
 */
export const getBookingTickets = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = (req as any).userId;

    if (!userId) {
      throw new Error("User ID not found. Please authenticate first.");
    }

    const bookingId = parseInt(req.params.id as string);

    if (!bookingId || isNaN(bookingId)) {
      throw new Error("Invalid booking ID");
    }

    const data = await service.getTicketsByBookingId(
      bookingId,
      parseInt(userId)
    );

    return res.json({
      success: true,
      data,
    });
  } catch (err: any) {
    next(err);
  }
};

/**
 * Get ticket generation job status (for real-time progress)
 * GET /api/v1/bookings/ticket-status/:jobId
 */
export const getTicketStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const jobId = req.params.jobId as string;

    if (!jobId) {
      throw new Error("Job ID is required");
    }

    const status = await getTicketJobStatus(jobId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: { message: "Ticket generation job not found" },
      });
    }

    return res.json({
      success: true,
      data: status,
    });
  } catch (err: any) {
    next(err);
  }
};


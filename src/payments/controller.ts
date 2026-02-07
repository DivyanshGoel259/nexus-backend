import { Request, Response, NextFunction } from "express";
import * as paymentService from "./service";
import { emitToAll } from "../lib/socket";
import db from "../lib/db";

/**
 * Create Razorpay order for booking
 * POST /api/v1/payments/create-order
 */
export const createOrder = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = (req as any).userId;

    if (!userId) {
      throw new Error("User ID not found. Please authenticate first.");
    }

    const { booking_id, amount, currency } = req.body;

    if (!booking_id) {
      throw new Error("Booking ID is required");
    }

    if (!amount || amount <= 0) {
      throw new Error("Valid amount is required");
    }

    // Verify booking belongs to user
    const booking = await db.oneOrNone(
      `SELECT id, user_id, total_amount, status 
       FROM bookings 
       WHERE id = $1 AND user_id = $2`,
      [booking_id, userId]
    );

    if (!booking) {
      throw new Error("Booking not found or you don't have permission to pay for this booking");
    }

    if (booking.status !== "pending") {
      throw new Error(`Booking is ${booking.status}, cannot create payment order`);
    }

    // Verify amount matches booking total
    if (Math.abs(parseFloat(booking.total_amount) - parseFloat(amount)) > 0.01) {
      throw new Error(`Amount mismatch. Booking total is ${booking.total_amount}`);
    }

    const order = await paymentService.createRazorpayOrder(
      parseInt(booking_id),
      parseFloat(amount),
      currency || "INR"
    );

    return res.json({
      success: true,
      data: order,
    });
  } catch (err: any) {
    next(err);
  }
};

/**
 * Handle Razorpay webhook
 * POST /api/v1/payments/webhook
 * 
 * This endpoint should be publicly accessible (no auth required)
 * Security is handled via webhook signature verification
 */
export const handleWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get signature from headers
    const signature = req.headers["x-razorpay-signature"] as string;

    if (!signature) {
      return res.status(400).json({
        success: false,
        error: "Missing Razorpay signature header",
      });
    }

    // Get raw body for signature verification
    // req.body is Buffer when using express.raw() middleware
    const rawBody = Buffer.isBuffer(req.body) 
      ? req.body.toString('utf8') 
      : JSON.stringify(req.body);
    
    // Parse body if it's a string
    const webhookData = typeof rawBody === 'string' ? JSON.parse(rawBody) : req.body;

    // Process webhook (pass rawBody for signature verification)
    const result = await paymentService.handleRazorpayWebhook(webhookData, signature, rawBody);

    // Broadcast booking confirmation if successful
    if (result.success && result.booking) {
      emitToAll("booking_confirmed", {
        booking_id: result.booking.id,
        booking_reference: result.booking.booking_reference,
        event_id: result.booking.event_id,
        total_tickets: result.tickets?.length || 0,
        status: result.booking.status,
      });
    }

    // Return 200 to Razorpay (they expect 200 for successful webhook processing)
    return res.status(200).json({
      success: true,
      message: "Webhook processed successfully",
    });
  } catch (err: any) {
    console.error("Webhook processing error:", err);

    // Still return 200 to Razorpay (they'll retry if needed)
    // But log the error for debugging
    return res.status(200).json({
      success: false,
      error: err.message,
    });
  }
};

/**
 * Verify payment status (for frontend polling/checking)
 * GET /api/v1/payments/verify/:orderId
 */
export const verifyPayment = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const orderId = req.params.orderId;

    if (!orderId) {
      throw new Error("Order ID is required");
    }

    // Get booking by order_id
    const booking = await db.oneOrNone(
      `SELECT id, booking_reference, status, payment_status, payment_id
       FROM bookings 
       WHERE payment_id = $1 AND payment_gateway = 'razorpay'`,
      [orderId]
    );

    if (!booking) {
      throw new Error("Order not found");
    }

    return res.json({
      success: true,
      data: {
        order_id: orderId,
        booking_id: booking.id,
        booking_reference: booking.booking_reference,
        status: booking.status,
        payment_status: booking.payment_status,
        is_confirmed: booking.status === "confirmed" && booking.payment_status === "completed",
      },
    });
  } catch (err: any) {
    next(err);
  }
};


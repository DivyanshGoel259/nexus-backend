import Razorpay from "razorpay";
import crypto from "crypto";
import db from "../lib/db";
import { confirmBooking } from "../bookings/service";

// Initialize Razorpay instance
let razorpayInstance: Razorpay | null = null;

/**
 * Get Razorpay instance (singleton)
 */
const getRazorpayInstance = (): Razorpay => {
  if (!razorpayInstance) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      throw new Error("Razorpay credentials not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in environment variables.");
    }

    razorpayInstance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  }

  return razorpayInstance;
};

/**
 * Create Razorpay order for booking
 * 
 * @param bookingId - Booking ID
 * @param amount - Amount in paise (INR * 100)
 * @param currency - Currency code (default: INR)
 * @param receipt - Receipt identifier (booking reference)
 */
export const createRazorpayOrder = async (
  bookingId: number,
  amount: number,
  currency: string = "INR",
  receipt?: string
) => {
  try {
    const razorpay = getRazorpayInstance();

    // Get booking details
    const booking = await db.oneOrNone(
      `SELECT booking_reference, total_amount, event_id, user_id 
       FROM bookings 
       WHERE id = $1 AND status = 'pending'`,
      [bookingId]
    );

    if (!booking) {
      throw new Error("Booking not found or already processed");
    }

    // Convert amount to paise (Razorpay uses smallest currency unit)
    const amountInPaise = Math.round(amount * 100);

    // Create order options
    const orderOptions = {
      amount: amountInPaise, // Amount in paise
      currency: currency,
      receipt: receipt || booking.booking_reference,
      notes: {
        booking_id: bookingId.toString(),
        booking_reference: booking.booking_reference,
        event_id: booking.event_id.toString(),
        user_id: booking.user_id.toString(),
      },
    };

    // Create Razorpay order
    const order = await razorpay.orders.create(orderOptions);

    // Update booking with payment order ID
    await db.none(
      `UPDATE bookings 
       SET payment_id = $1, 
           payment_gateway = 'razorpay'
       WHERE id = $2`,
      [order.id, bookingId]
    );

    return {
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      status: order.status,
      key_id: process.env.RAZORPAY_KEY_ID,
      // Frontend will use this to initialize Razorpay checkout
      checkout_options: {
        key: process.env.RAZORPAY_KEY_ID,
        amount: order.amount,
        currency: order.currency,
        name: "Event Booking",
        description: `Booking: ${booking.booking_reference}`,
        order_id: order.id,
        prefill: {
          // Can be populated from user data if available
        },
        theme: {
          color: "#3399cc",
        },
        handler: function (response: any) {
          // This will be handled by frontend
          // Frontend should call webhook endpoint after payment
        },
      },
    };
  } catch (error: any) {
    throw new Error(`Failed to create Razorpay order: ${error.message}`);
  }
};

/**
 * Verify Razorpay webhook signature
 * 
 * @param webhookBody - Raw webhook body (string)
 * @param signature - Razorpay signature from headers
 * @param secret - Razorpay webhook secret
 */
export const verifyWebhookSignature = (
  webhookBody: string,
  signature: string,
  secret: string
): boolean => {
  try {
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(webhookBody)
      .digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    return false;
  }
};

/**
 * Handle Razorpay payment webhook
 * Processes payment.success event and confirms booking
 * 
 * @param webhookData - Parsed webhook payload
 * @param signature - Webhook signature for verification
 * @param rawBody - Raw webhook body string (for signature verification)
 */
export const handleRazorpayWebhook = async (
  webhookData: any,
  signature: string,
  rawBody?: string
) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      throw new Error("Razorpay webhook secret not configured");
    }

    // Verify webhook signature (security check)
    // Use rawBody if provided, otherwise stringify webhookData
    const webhookBody = rawBody || JSON.stringify(webhookData);
    const isValid = verifyWebhookSignature(webhookBody, signature, webhookSecret);

    if (!isValid) {
      throw new Error("Invalid webhook signature");
    }

    const event = webhookData.event;
    const payload = webhookData.payload;

    // Handle payment.success event
    if (event === "payment.captured" || event === "payment.authorized") {
      const paymentEntity = payload.payment?.entity || payload.payment;
      const orderId = paymentEntity.order_id;
      const paymentId = paymentEntity.id;
      const amount = paymentEntity.amount / 100; // Convert from paise to INR
      const status = paymentEntity.status;

      if (status !== "captured" && status !== "authorized") {
        throw new Error(`Payment status is ${status}, expected captured or authorized`);
      }

      // Get booking by order_id (stored in payment_id field)
      const booking = await db.oneOrNone(
        `SELECT id, booking_reference, total_amount, status, payment_status
         FROM bookings 
         WHERE payment_id = $1 AND payment_gateway = 'razorpay'`,
        [orderId]
      );

      if (!booking) {
        throw new Error(`Booking not found for order_id: ${orderId}`);
      }

      // Verify amount matches
      if (Math.abs(parseFloat(booking.total_amount) - amount) > 0.01) {
        throw new Error(`Amount mismatch. Expected: ${booking.total_amount}, Received: ${amount}`);
      }

      // Check if booking is already confirmed
      if (booking.status === "confirmed" && booking.payment_status === "completed") {
        // Already confirmed - idempotent, return success
        return {
          success: true,
          message: "Booking already confirmed",
          booking_id: booking.id,
          booking_reference: booking.booking_reference,
          idempotent: true,
        };
      }

      // Confirm booking (this will convert seats to booked and generate tickets)
      const confirmedBooking = await confirmBooking(
        booking.id,
        paymentId, // Use Razorpay payment ID
        "razorpay"
      );

      return {
        success: true,
        message: "Payment verified and booking confirmed",
        booking: confirmedBooking.booking,
        tickets: confirmedBooking.tickets,
      };
    }

    // Handle payment.failed event
    if (event === "payment.failed") {
      const paymentEntity = payload.payment?.entity || payload.payment;
      const orderId = paymentEntity.order_id;

      // Get booking
      const booking = await db.oneOrNone(
        `SELECT id FROM bookings WHERE payment_id = $1 AND payment_gateway = 'razorpay'`,
        [orderId]
      );

      if (booking) {
        // Update booking payment status to failed
        await db.none(
          `UPDATE bookings 
           SET payment_status = 'failed'
           WHERE id = $1`,
          [booking.id]
        );
      }

      return {
        success: false,
        message: "Payment failed",
        order_id: orderId,
      };
    }

    // Other events (order.paid, etc.) - log but don't process
    return {
      success: true,
      message: `Event ${event} received but not processed`,
      event: event,
    };
  } catch (error: any) {
    throw new Error(`Webhook processing failed: ${error.message}`);
  }
};


import db from "../lib/db";
import QRCode from "qrcode";
import crypto from "crypto";
import { invalidateEventAvailability, invalidateSeatAvailability } from "../lib/cache/seatAvailabilityCache";
import { invalidateEventCache } from "../lib/cache/eventCache";
import { dispatchTicketGeneration, getBookingTickets, type TicketJobData } from "../lib/jobs/ticketQueue";

/**
 * Generate unique booking reference
 * Format: BKG-YYYY-MMDD-HHMMSS-XXXX (e.g., BKG-2026-0120-143025-A1B2)
 */
const generateBookingReference = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const random = crypto.randomBytes(2).toString("hex").toUpperCase();
  
  return `BKG-${year}-${month}${day}-${hours}${minutes}${seconds}-${random}`;
};

/**
 * Generate unique ticket ID for QR code
 * Format: TKT-{booking_ref}-{seat_label} (e.g., TKT-BKG-2026-0120-143025-A1B2-V1)
 */
const generateTicketId = (bookingRef: string, seatLabel: string): string => {
  return `TKT-${bookingRef}-${seatLabel}`;
};

/**
 * Generate QR code data URL for a ticket
 */
const generateQRCode = async (ticketId: string): Promise<string> => {
  try {
    const qrDataUrl = await QRCode.toDataURL(ticketId, {
      errorCorrectionLevel: "H",
      type: "image/png",
      width: 300,
      margin: 2,
    });
    return qrDataUrl;
  } catch (error: any) {
    throw new Error(`Failed to generate QR code: ${error.message}`);
  }
};

/**
 * Create booking from locked seats
 * Step 2: User has locked seats, now creates booking (payment pending)
 * 
 * @param eventId - Event ID
 * @param userId - User ID making the booking
 * @param seatDetails - Array of seat details (seat_label, seat_type_id)
 */
export const createBooking = async (
  eventId: number,
  userId: number,
  seatDetails: Array<{
    seat_label: string;
    seat_type_id: number;
  }>
) => {
  try {
    // Validate inputs
    if (!eventId || !userId || !seatDetails || seatDetails.length === 0) {
      throw new Error("Event ID, User ID, and at least one seat are required");
    }

    // Validate event exists and is published
    const event = await db.oneOrNone(
      `SELECT id, name, status, start_date, end_date FROM events WHERE id = $1`,
      [eventId]
    );

    if (!event) {
      throw new Error("Event not found");
    }

    if (event.status !== "published") {
      throw new Error("Event is not available for booking");
    }

    // Check if event has started
    const now = new Date();
    if (new Date(event.start_date) < now) {
      throw new Error("Event has already started. Booking is closed.");
    }

    return await db.tx(async (t) => {
      // 1. Lock and verify all locked seats exist, belong to user, and are not expired
      // Using SELECT FOR UPDATE to prevent race conditions - locks rows until transaction commits
      const seatLabels = seatDetails.map((s) => s.seat_label.trim().toUpperCase());
      const seatTypeIds = seatDetails.map((s) => s.seat_type_id);

      const lockedSeats = await t.manyOrNone(
        `SELECT 
          s.id, s.event_id, s.event_seat_type_id, s.seat_label, s.user_id, s.status, s.expires_at,
          est.name as seat_type_name, est.price
        FROM seats s
        INNER JOIN event_seat_types est ON s.event_seat_type_id = est.id
        WHERE s.event_id = $1
          AND s.user_id = $2
          AND s.status = 'locked'
          AND s.expires_at > CURRENT_TIMESTAMP
          AND s.seat_label = ANY($3::text[])
          AND s.event_seat_type_id = ANY($4::int[])
        ORDER BY s.id
        FOR UPDATE OF s`,
        [eventId, userId, seatLabels, seatTypeIds]
      );

      if (!lockedSeats || lockedSeats.length !== seatDetails.length) {
        throw new Error(
          "One or more seats are not locked by you, have expired, or do not exist. Please lock the seats again."
        );
      }

      // 2. Check if any of these seats are already linked to another booking (race condition check)
      const seatIds = lockedSeats.map((s) => s.id);
      const existingBookings = await t.manyOrNone(
        `SELECT bs.seat_id, b.booking_reference
         FROM booking_seats bs
         INNER JOIN bookings b ON bs.booking_id = b.id
         WHERE bs.seat_id = ANY($1::int[])
           AND b.status != 'cancelled'`,
        [seatIds]
      );

      if (existingBookings && existingBookings.length > 0) {
        throw new Error(
          "One or more seats are already linked to another booking. Please lock the seats again."
        );
      }

      // 3. Verify seat labels match seat type IDs
      for (const seatDetail of seatDetails) {
        const lockedSeat = lockedSeats.find(
          (s) =>
            s.seat_label.trim().toUpperCase() === seatDetail.seat_label.trim().toUpperCase() &&
            s.event_seat_type_id === seatDetail.seat_type_id
        );
        if (!lockedSeat) {
          throw new Error(
            `Seat ${seatDetail.seat_label} does not match seat type ${seatDetail.seat_type_id}`
          );
        }
      }

      // 4. Calculate total amount
      let totalAmount = 0;
      const seatInfo: any[] = [];

      for (const lockedSeat of lockedSeats) {
        const price = parseFloat(lockedSeat.price);
        totalAmount += price;
        seatInfo.push({
          seat_id: lockedSeat.id,
          seat_label: lockedSeat.seat_label,
          seat_type_id: lockedSeat.event_seat_type_id,
          seat_type_name: lockedSeat.seat_type_name,
          price: price,
        });
      }

      // 5. Generate unique booking reference
      let bookingRef = generateBookingReference();
      
      // Ensure uniqueness (retry if duplicate)
      let retries = 0;
      while (retries < 5) {
        const existing = await t.oneOrNone(
          `SELECT id FROM bookings WHERE booking_reference = $1 FOR UPDATE`,
          [bookingRef]
        );
        if (!existing) break;
        bookingRef = generateBookingReference();
        retries++;
      }

      if (retries >= 5) {
        throw new Error("Failed to generate unique booking reference. Please try again.");
      }

      // 6. Set booking expiry (15 minutes from now - gives time for payment)
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 15);

      // 7. Create booking record (status='pending', payment_status='pending')
      const booking = await t.one(
        `INSERT INTO bookings(
          booking_reference, event_id, user_id, total_amount, status, payment_status, expires_at
        ) 
        VALUES($1, $2, $3, $4, 'pending', 'pending', $5)
        RETURNING id, booking_reference, event_id, user_id, total_amount, status, payment_status, booked_at, expires_at`,
        [bookingRef, eventId, userId, totalAmount, expiresAt]
      );

      // 8. Link locked seats to booking atomically (seats remain 'locked' until payment confirmed)
      // Using ON CONFLICT to prevent duplicate seat bookings (UNIQUE constraint on booking_seats)
      for (const seatInfoItem of seatInfo) {
        await t.none(
          `INSERT INTO booking_seats(booking_id, seat_id, price_paid)
           VALUES($1, $2, $3)
           ON CONFLICT (booking_id, seat_id) DO NOTHING`,
          [booking.id, seatInfoItem.seat_id, seatInfoItem.price]
        );
      }

      // 9. Verify all seats were linked (double-check after insert)
      const linkedSeatsCount = await t.one(
        `SELECT COUNT(*) as count FROM booking_seats WHERE booking_id = $1`,
        [booking.id],
        (row: any) => parseInt(row.count)
      );

      if (linkedSeatsCount !== seatInfo.length) {
        throw new Error("Failed to link all seats to booking. Please try again.");
      }

      // 10. Get event details
      const eventDetails = await t.oneOrNone(
        `SELECT id, name, description, start_date, end_date, location, venue_name, image_url
         FROM events WHERE id = $1`,
        [eventId]
      );

      return {
        booking: {
          id: booking.id,
          booking_reference: booking.booking_reference,
          event_id: booking.event_id,
          user_id: booking.user_id,
          total_amount: parseFloat(booking.total_amount),
          status: booking.status,
          payment_status: booking.payment_status,
          booked_at: booking.booked_at,
          expires_at: booking.expires_at,
        },
        event: eventDetails,
        seats: seatInfo.map((s) => ({
          seat_id: s.seat_id,
          seat_label: s.seat_label,
          seat_type_id: s.seat_type_id,
          seat_type_name: s.seat_type_name,
          price: s.price,
        })),
        total_seats: seatInfo.length,
        message: `Booking created successfully. Please complete payment within 15 minutes.`,
        payment_required: true,
      };
    });
  } catch (err: any) {
    throw err;
  }
};

/**
 * Confirm booking after payment
 * Step 4: Payment successful, convert locked seats to booked, generate tickets
 * 
 * @param bookingId - Booking ID
 * @param paymentId - Payment gateway transaction ID
 * @param paymentGateway - Payment gateway name (razorpay, stripe, etc.)
 */
export const confirmBooking = async (
  bookingId: number,
  paymentId: string,
  paymentGateway: string = "razorpay"
) => {
  try {
    if (!bookingId || !paymentId) {
      throw new Error("Booking ID and Payment ID are required");
    }

    // Variables to store data outside transaction for QR generation
    let confirmedBooking: any;
    let updatedSeats: any[] = [];
    let eventDetails: any;
    let userDetails: any;

    await db.tx(async (t) => {
      // 1. Lock and get booking details (FOR UPDATE prevents concurrent modifications)
      const booking = await t.oneOrNone(
        `SELECT 
          id, booking_reference, event_id, user_id, total_amount, status, payment_status, expires_at
        FROM bookings 
        WHERE id = $1
        FOR UPDATE`,
        [bookingId]
      );

      if (!booking) {
        throw new Error("Booking not found");
      }

      // 2. Check if booking is already confirmed (optimistic locking check)
      if (booking.status === "confirmed" && booking.payment_status === "completed") {
        throw new Error("Booking is already confirmed");
      }

      // 3. Check if booking has expired
      if (booking.expires_at && new Date(booking.expires_at) < new Date()) {
        throw new Error("Booking has expired. Please create a new booking.");
      }

      // 4. Lock and get all locked seats linked to this booking (FOR UPDATE prevents race conditions)
      const lockedSeats = await t.manyOrNone(
        `SELECT 
          s.id, s.event_id, s.event_seat_type_id, s.seat_label, s.user_id, s.status,
          est.name as seat_type_name, est.price,
          bs.price_paid
        FROM booking_seats bs
        INNER JOIN seats s ON bs.seat_id = s.id
        INNER JOIN event_seat_types est ON s.event_seat_type_id = est.id
        WHERE bs.booking_id = $1 AND s.status = 'locked'
        ORDER BY s.id
        FOR UPDATE OF s`,
        [bookingId]
      );

      if (!lockedSeats || lockedSeats.length === 0) {
        throw new Error("No locked seats found for this booking");
      }

      // 5. Update booking status and payment info atomically (only if still pending)
      confirmedBooking = await t.oneOrNone(
        `UPDATE bookings
         SET status = 'confirmed',
             payment_status = 'completed',
             payment_id = $1,
             payment_gateway = $2,
             confirmed_at = CURRENT_TIMESTAMP
         WHERE id = $3
           AND status = 'pending'
           AND payment_status = 'pending'
         RETURNING id, booking_reference, event_id, user_id, total_amount, status, payment_status, booked_at, confirmed_at, payment_id, payment_gateway`,
        [paymentId, paymentGateway, bookingId]
      );

      if (!confirmedBooking) {
        throw new Error("Booking could not be confirmed. It may have already been confirmed or cancelled.");
      }

      // 6. Convert locked seats to booked seats atomically (quick transaction)
      updatedSeats = [];

      for (const lockedSeat of lockedSeats) {
        // Update seat status from 'locked' to 'booked' atomically (only if still locked)
        const updatedSeat = await t.oneOrNone(
          `UPDATE seats
           SET status = 'booked', booked_at = CURRENT_TIMESTAMP
           WHERE id = $1 
             AND status = 'locked'
             AND event_id = $2
           RETURNING id, event_id, event_seat_type_id, seat_label, user_id, booked_at, status`,
          [lockedSeat.id, booking.event_id]
        );

        if (!updatedSeat) {
          throw new Error(`Seat ${lockedSeat.seat_label} could not be booked. It may have been booked by another transaction.`);
        }

        updatedSeats.push({
          seat: updatedSeat,
          seatTypeName: lockedSeat.seat_type_name,
          pricePaid: parseFloat(lockedSeat.price_paid),
        });
      }

      // 7. Get event and user details
      eventDetails = await t.oneOrNone(
        `SELECT id, name, description, start_date, end_date, location, venue_name, image_url
         FROM events WHERE id = $1`,
        [confirmedBooking.event_id]
      );

      userDetails = await t.oneOrNone(
        `SELECT id, name, email, phone FROM users WHERE id = $1`,
        [confirmedBooking.user_id]
      );

      // Transaction commits here - seats are now booked
      // QR codes generated in parallel after transaction (non-blocking)
    });

    // ⚡ Invalidate event cache (seat statuses changed from locked → booked)
    await invalidateEventCache(confirmedBooking.event_id);

    // 8. Dispatch ticket generation to BullMQ queue (async — non-blocking)
    // QR codes, PDF, email/SMS are generated by the worker in the background
    const ticketJobData: TicketJobData = {
      bookingId: confirmedBooking.id,
      bookingReference: confirmedBooking.booking_reference,
      eventId: confirmedBooking.event_id,
      userId: confirmedBooking.user_id,
      event: {
        name: eventDetails?.name || "",
        start_date: eventDetails?.start_date || "",
        end_date: eventDetails?.end_date || "",
        location: eventDetails?.location || "",
        venue_name: eventDetails?.venue_name || null,
      },
      user: {
        name: userDetails?.name || "",
        email: userDetails?.email || "",
        phone: userDetails?.phone || "",
      },
      seats: updatedSeats.map((seatData: any) => ({
        seatId: seatData.seat.id,
        seatLabel: seatData.seat.seat_label,
        seatTypeId: seatData.seat.event_seat_type_id,
        seatTypeName: seatData.seatTypeName,
        pricePaid: seatData.pricePaid,
        bookedAt: seatData.seat.booked_at,
      })),
    };

    let ticketJob = { jobId: "pending", status: "queued" };
    try {
      ticketJob = await dispatchTicketGeneration(ticketJobData);
    } catch (dispatchErr: any) {
      // Non-fatal — tickets will be generated on retry or manual trigger
      console.error("⚠️ Ticket generation dispatch failed:", dispatchErr.message);
    }

    // If queue not available, fall back to synchronous QR generation
    let tickets: any[] = [];
    if (ticketJob.status === "sync-fallback") {
      tickets = await Promise.all(
        updatedSeats.map(async (seatData: any) => {
          const ticketId = generateTicketId(confirmedBooking.booking_reference, seatData.seat.seat_label);
          const qrCode = await generateQRCode(ticketId);
          return {
            ticket_id: ticketId,
            seat_id: seatData.seat.id,
            seat_label: seatData.seat.seat_label,
            seat_type_id: seatData.seat.event_seat_type_id,
            seat_type_name: seatData.seatTypeName,
            price: seatData.pricePaid,
            qr_code: qrCode,
            booked_at: seatData.seat.booked_at,
          };
        })
      );
    }

    return {
      booking: {
        id: confirmedBooking.id,
        booking_reference: confirmedBooking.booking_reference,
        event_id: confirmedBooking.event_id,
        user_id: confirmedBooking.user_id,
        total_amount: parseFloat(confirmedBooking.total_amount),
        status: confirmedBooking.status,
        payment_status: confirmedBooking.payment_status,
        payment_id: confirmedBooking.payment_id,
        payment_gateway: confirmedBooking.payment_gateway,
        booked_at: confirmedBooking.booked_at,
        confirmed_at: confirmedBooking.confirmed_at,
      },
      event: eventDetails,
      user: userDetails,
      tickets: tickets, // Empty if async (client polls or gets WebSocket push)
      total_tickets: updatedSeats.length,
      ticket_generation: {
        jobId: ticketJob.jobId,
        status: ticketJob.status,
        message:
          ticketJob.status === "queued"
            ? `${updatedSeats.length} ticket(s) are being generated. You'll be notified when ready.`
            : `${tickets.length} ticket(s) generated synchronously.`,
      },
      message: `Booking confirmed! ${updatedSeats.length} seat(s) booked successfully.`,
    };
  } catch (err: any) {
    throw err;
  }
};

/**
 * Get booking by ID
 */
export const getBookingById = async (bookingId: number, userId?: number) => {
  try {
    let query = `
      SELECT 
        b.id, b.booking_reference, b.event_id, b.user_id, b.total_amount,
        b.status, b.payment_status, b.payment_id, b.payment_gateway,
        b.booked_at, b.confirmed_at, b.cancelled_at, b.expires_at,
        e.name as event_name, e.start_date, e.end_date, e.location, e.venue_name, e.image_url
      FROM bookings b
      INNER JOIN events e ON b.event_id = e.id
      WHERE b.id = $1
    `;
    const params: any[] = [bookingId];

    // If userId provided, ensure user owns the booking
    if (userId) {
      query += ` AND b.user_id = $2`;
      params.push(userId);
    }

    const booking = await db.oneOrNone(query, params);

    if (!booking) {
      throw new Error("Booking not found");
    }

    // Get seats for this booking
    const seats = await db.manyOrNone(
      `SELECT 
        s.id, s.seat_label, s.status, s.booked_at,
        est.name as seat_type_name, est.price,
        bs.price_paid
      FROM booking_seats bs
      INNER JOIN seats s ON bs.seat_id = s.id
      INNER JOIN event_seat_types est ON s.event_seat_type_id = est.id
      WHERE bs.booking_id = $1
      ORDER BY s.seat_label`,
      [bookingId]
    );

    return {
      booking: {
        id: booking.id,
        booking_reference: booking.booking_reference,
        event_id: booking.event_id,
        user_id: booking.user_id,
        total_amount: parseFloat(booking.total_amount),
        status: booking.status,
        payment_status: booking.payment_status,
        payment_id: booking.payment_id,
        payment_gateway: booking.payment_gateway,
        booked_at: booking.booked_at,
        confirmed_at: booking.confirmed_at,
        cancelled_at: booking.cancelled_at,
        expires_at: booking.expires_at,
      },
      event: {
        id: booking.event_id,
        name: booking.event_name,
        start_date: booking.start_date,
        end_date: booking.end_date,
        location: booking.location,
        venue_name: booking.venue_name,
        image_url: booking.image_url,
      },
      seats: seats.map((s) => ({
        seat_id: s.id,
        seat_label: s.seat_label,
        seat_type_name: s.seat_type_name,
        price: parseFloat(s.price_paid),
        status: s.status,
        booked_at: s.booked_at,
      })),
    };
  } catch (err: any) {
    throw err;
  }
};

/**
 * Get tickets for a booking (from tickets table — async generated)
 * Used by clients to poll ticket status after confirmBooking
 */
export const getTicketsByBookingId = async (
  bookingId: number,
  userId?: number
): Promise<{ tickets: any[]; status: string }> => {
  try {
    // Verify booking ownership if userId provided
    if (userId) {
      const booking = await db.oneOrNone(
        `SELECT id FROM bookings WHERE id = $1 AND user_id = $2`,
        [bookingId, userId]
      );
      if (!booking) {
        throw new Error("Booking not found or unauthorized");
      }
    }

    const tickets = await getBookingTickets(bookingId);

    if (!tickets || tickets.length === 0) {
      return { tickets: [], status: "pending" };
    }

    const allGenerated = tickets.every((t) => t.status === "generated" || t.status === "delivered");
    const anyFailed = tickets.some((t) => t.status === "failed");

    return {
      tickets: tickets.map((t) => ({
        id: t.id,
        ticket_id: t.ticket_id,
        seat_label: t.seat_label,
        seat_type_name: t.seat_type_name,
        price_paid: parseFloat(t.price_paid),
        qr_code: t.qr_code,
        status: t.status,
        email_sent: t.email_sent,
        sms_sent: t.sms_sent,
        generated_at: t.generated_at,
        delivered_at: t.delivered_at,
      })),
      status: anyFailed ? "partial" : allGenerated ? "ready" : "generating",
    };
  } catch (err: any) {
    throw err;
  }
};

/**
 * Get all bookings for a user
 */
export const getBookingsByUser = async (userId: number, options?: {
  status?: string;
  limit?: number;
  offset?: number;
}) => {
  try {
    const limit = options?.limit || 10;
    const offset = options?.offset || 0;

    let query = `
      SELECT 
        b.id, b.booking_reference, b.event_id, b.user_id, b.total_amount,
        b.status, b.payment_status, b.booked_at, b.confirmed_at, b.expires_at,
        e.name as event_name, e.start_date, e.end_date, e.image_url
      FROM bookings b
      INNER JOIN events e ON b.event_id = e.id
      WHERE b.user_id = $1
    `;
    const params: any[] = [userId];

    if (options?.status) {
      query += ` AND b.status = $2`;
      params.push(options.status);
    }

    query += ` ORDER BY b.booked_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const bookings = await db.manyOrNone(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) as total FROM bookings WHERE user_id = $1`;
    const countParams: any[] = [userId];

    if (options?.status) {
      countQuery += ` AND status = $2`;
      countParams.push(options.status);
    }

    const totalCount = await db.one(countQuery, countParams, (row: any) => parseInt(row.total));

    return {
      bookings: bookings.map((b) => ({
        id: b.id,
        booking_reference: b.booking_reference,
        event_id: b.event_id,
        event_name: b.event_name,
        start_date: b.start_date,
        end_date: b.end_date,
        image_url: b.image_url,
        total_amount: parseFloat(b.total_amount),
        status: b.status,
        payment_status: b.payment_status,
        booked_at: b.booked_at,
        confirmed_at: b.confirmed_at,
        expires_at: b.expires_at,
      })),
      pagination: {
        total: totalCount,
        limit,
        offset,
        has_more: offset + bookings.length < totalCount,
      },
    };
  } catch (err: any) {
    throw err;
  }
};

/**
 * Cancel booking (only if pending and not confirmed)
 * 
 * @param bookingId - Booking ID
 * @param userId - User ID
 * @param reason - Cancellation reason (optional)
 * @param idempotencyKey - Client-provided idempotency key for safe retries (optional)
 */
export const cancelBooking = async (
  bookingId: number,
  userId: number,
  reason?: string,
  idempotencyKey?: string
) => {
  try {
    // If idempotency key provided, check for existing operation
    if (idempotencyKey) {
      const existingOperation = await db.oneOrNone(
        `SELECT id, status, response_data, completed_at
         FROM idempotency_keys
         WHERE idempotency_key = $1
           AND operation_type = 'cancel_booking'
           AND resource_id = $2
           AND user_id = $3
           AND expires_at > CURRENT_TIMESTAMP`,
        [idempotencyKey, bookingId, userId]
      );

      if (existingOperation) {
        if (existingOperation.status === 'completed') {
          // Return cached response for idempotent retry
          return {
            message: "Booking cancelled successfully (idempotent retry)",
            booking_id: bookingId,
            idempotent: true,
            cached_response: existingOperation.response_data,
          };
        }
        // If status is 'pending', another request is processing - wait or return error
        if (existingOperation.status === 'pending') {
          throw new Error("A cancellation request for this booking is already in progress. Please wait.");
        }
      }
    }

    return await db.tx(async (t) => {
      // Create idempotency key record if provided (lock it)
      let idempotencyKeyId: number | null = null;
      if (idempotencyKey) {
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour expiry

        try {
          const idempotencyRecord = await t.oneOrNone(
            `INSERT INTO idempotency_keys(
              idempotency_key, operation_type, resource_id, user_id, status, expires_at
            )
            VALUES($1, 'cancel_booking', $2, $3, 'pending', $4)
            ON CONFLICT (idempotency_key) DO NOTHING
            RETURNING id`,
            [idempotencyKey, bookingId, userId, expiresAt]
          );

          if (!idempotencyRecord) {
            // Another request with same key is processing
            throw new Error("A cancellation request with this idempotency key is already in progress.");
          }

          idempotencyKeyId = idempotencyRecord.id;
        } catch (error: any) {
          if (error.message.includes('idempotency')) {
            throw error;
          }
          // If insert fails for other reasons, continue without idempotency
        }
      }

      // 1. Lock and get booking details (FOR UPDATE SKIP LOCKED prevents deadlocks)
      const booking = await t.oneOrNone(
        `SELECT id, user_id, status, payment_status 
         FROM bookings 
         WHERE id = $1
         FOR UPDATE SKIP LOCKED`,
        [bookingId]
      );

      if (!booking) {
        // If booking not found, it might be locked by another transaction
        // Check if it exists without lock
        const bookingExists = await t.oneOrNone(
          `SELECT id FROM bookings WHERE id = $1`,
          [bookingId]
        );
        if (!bookingExists) {
          throw new Error("Booking not found");
        }
        throw new Error("Booking is currently being processed by another request. Please try again.");
      }

      // 2. Verify user owns the booking
      if (parseInt(booking.user_id.toString()) !== parseInt(userId.toString())) {
        throw new Error("You are not authorized to cancel this booking");
      }

      // 3. Check if booking can be cancelled
      if (booking.status === "confirmed" && booking.payment_status === "completed") {
        throw new Error("Cannot cancel confirmed booking. Please request a refund.");
      }

      if (booking.status === "cancelled") {
        // Already cancelled - return success (idempotent)
        const result = {
          message: "Booking is already cancelled",
          booking_id: bookingId,
          already_cancelled: true,
        };

        // Update idempotency key if exists
        if (idempotencyKeyId) {
          await t.none(
            `UPDATE idempotency_keys
             SET status = 'completed',
                 response_data = $1::jsonb,
                 completed_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [JSON.stringify(result), idempotencyKeyId]
          );
        }

        return result;
      }

      // 4. Lock and get locked seats for this booking (SKIP LOCKED prevents deadlocks)
      const lockedSeats = await t.manyOrNone(
        `SELECT s.id, s.event_id, s.event_seat_type_id
         FROM booking_seats bs
         INNER JOIN seats s ON bs.seat_id = s.id
         WHERE bs.booking_id = $1 
           AND s.status = 'locked'
         FOR UPDATE OF s SKIP LOCKED`,
        [bookingId]
      );

      // 5. Update booking status atomically (only if not already cancelled)
      const cancelledBooking = await t.oneOrNone(
        `UPDATE bookings
         SET status = 'cancelled',
             payment_status = 'refunded',
             cancelled_at = CURRENT_TIMESTAMP,
             cancellation_reason = $1
         WHERE id = $2
           AND status != 'cancelled'
         RETURNING id, status`,
        [reason || "Cancelled by user", bookingId]
      );

      if (!cancelledBooking) {
        throw new Error("Booking could not be cancelled. It may have already been cancelled.");
      }

      // 6. Delete locked seats and restore available_quantity
      if (lockedSeats && lockedSeats.length > 0) {
        // Delete locked seats atomically
        const deletedSeats = await t.manyOrNone(
          `DELETE FROM seats 
           WHERE id = ANY($1::int[])
             AND status = 'locked'
           RETURNING event_seat_type_id`,
          [lockedSeats.map((s) => s.id)]
        );

        // Restore available_quantity for each seat type atomically
        if (deletedSeats && deletedSeats.length > 0) {
          const seatTypeCounts = deletedSeats.reduce((acc: any, seat: any) => {
            acc[seat.event_seat_type_id] = (acc[seat.event_seat_type_id] || 0) + 1;
            return acc;
          }, {});

          for (const [seatTypeId, count] of Object.entries(seatTypeCounts)) {
            await t.none(
              `UPDATE event_seat_types
               SET available_quantity = LEAST(quantity, available_quantity + $1)
               WHERE id = $2`,
              [count, seatTypeId]
            );
          }
        }
      }

      // ⚡ Invalidate seat availability & event cache (seats restored)
      if (lockedSeats && lockedSeats.length > 0) {
        const eventId = parseInt(lockedSeats[0].event_id);
        const uniqueSeatTypeIds = [...new Set(lockedSeats.map((s: any) => parseInt(s.event_seat_type_id)))];
        for (const stId of uniqueSeatTypeIds) {
          await invalidateSeatAvailability(eventId, stId as number);
        }
        await invalidateEventCache(eventId);
      }

      const result = {
        message: "Booking cancelled successfully",
        booking_id: bookingId,
      };

      // 7. Update idempotency key if exists
      if (idempotencyKeyId) {
        await t.none(
          `UPDATE idempotency_keys
           SET status = 'completed',
               response_data = $1::jsonb,
               completed_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [JSON.stringify(result), idempotencyKeyId]
        );
      }

      return result;
    });
  } catch (err: any) {
    // Mark idempotency key as failed if exists
    if (idempotencyKey) {
      try {
        await db.none(
          `UPDATE idempotency_keys
           SET status = 'failed',
               completed_at = CURRENT_TIMESTAMP
           WHERE idempotency_key = $1
             AND operation_type = 'cancel_booking'
             AND resource_id = $2`,
          [idempotencyKey, bookingId]
        );
      } catch (updateErr) {
        // Ignore errors updating idempotency key
      }
    }
    throw err;
  }
};


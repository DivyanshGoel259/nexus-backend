import { Queue, Worker, QueueEvents, Job } from "bullmq";
import QRCode from "qrcode";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

/**
 * BullMQ Ticket Generation Queue
 *
 * Moves heavy ticket work out of the booking confirmation path:
 *  1. QR code generation (base64 PNG ~300ms each)
 *  2. Persist tickets to DB
 *  3. Future: PDF rendering, email/SMS delivery
 *
 * Flow:
 *  confirmBooking() → dispatches "generate-tickets" job → returns immediately
 *  Worker picks up job → generates QR → inserts into `tickets` table
 *  Client polls GET /bookings/:id or receives WebSocket push
 *
 * Queue: "ticket-generation"
 * Jobs:
 *  - generate-tickets : bulk QR gen + DB persist for a confirmed booking
 *  - send-ticket-email: (future) email delivery
 *  - send-ticket-sms  : (future) SMS delivery
 */

// ── Redis connection (same pattern as cleanupJobs) ──
const getRedisConnection = () => {
  if (process.env.REDIS_URL) {
    const url = new URL(process.env.REDIS_URL);
    return {
      host: url.hostname,
      port: parseInt(url.port || "6379"),
      password: url.password || undefined,
      username: url.username !== "default" ? url.username : undefined,
      maxRetriesPerRequest: null as unknown as number,
    };
  }
  return {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null as unknown as number,
  };
};

// ── Constants ──
const TICKET_QUEUE = "ticket-generation";

const JOBS = {
  GENERATE_TICKETS: "generate-tickets",
  SEND_EMAIL: "send-ticket-email",
  SEND_SMS: "send-ticket-sms",
} as const;

// ── Types ──
export interface TicketJobData {
  bookingId: number;
  bookingReference: string;
  eventId: number;
  userId: number;
  event: {
    name: string;
    start_date: string;
    end_date: string;
    location: string;
    venue_name: string | null;
  };
  user: {
    name: string;
    email: string;
    phone: string;
  };
  seats: Array<{
    seatId: number;
    seatLabel: string;
    seatTypeId: number;
    seatTypeName: string;
    pricePaid: number;
    bookedAt: string;
  }>;
}

export interface EmailJobData {
  bookingId: number;
  userId: number;
  email: string;
  userName: string;
  bookingReference: string;
  eventName: string;
  ticketCount: number;
}

export interface SmsJobData {
  bookingId: number;
  userId: number;
  phone: string;
  userName: string;
  bookingReference: string;
  eventName: string;
  ticketCount: number;
}

// ── Instances ──
let ticketQueue: Queue | null = null;
let ticketWorker: Worker | null = null;
let ticketQueueEvents: QueueEvents | null = null;

// ════════════════════════════════════════════════════════════
//  QR Code Generation (moved from bookings/service.ts)
// ════════════════════════════════════════════════════════════

/**
 * Generate unique ticket ID
 * Format: TKT-{booking_ref}-{seat_label}
 */
const generateTicketId = (bookingRef: string, seatLabel: string): string => {
  return `TKT-${bookingRef}-${seatLabel}`;
};

/**
 * Generate QR code as base64 data URL
 */
const generateQRCode = async (ticketId: string): Promise<string> => {
  const qrDataUrl = await QRCode.toDataURL(ticketId, {
    errorCorrectionLevel: "H",
    type: "image/png",
    width: 300,
    margin: 2,
  });
  return qrDataUrl;
};

// ════════════════════════════════════════════════════════════
//  Job Processor
// ════════════════════════════════════════════════════════════

const processTicketJob = async (job: Job): Promise<any> => {
  const startTime = Date.now();
  console.log(`🎫 [${job.name}] Starting... (attempt ${job.attemptsMade + 1})`);

  try {
    switch (job.name) {
      case JOBS.GENERATE_TICKETS: {
        const data = job.data as TicketJobData;
        return await handleGenerateTickets(data, job);
      }

      case JOBS.SEND_EMAIL: {
        const data = job.data as EmailJobData;
        return await handleSendEmail(data);
      }

      case JOBS.SEND_SMS: {
        const data = job.data as SmsJobData;
        return await handleSendSms(data);
      }

      default:
        throw new Error(`Unknown ticket job: ${job.name}`);
    }
  } catch (err: any) {
    const duration = Date.now() - startTime;
    console.error(`❌ [${job.name}] Failed after ${duration}ms:`, err.message);
    throw err;
  }
};

/**
 * Generate QR codes + persist tickets to DB
 */
const handleGenerateTickets = async (
  data: TicketJobData,
  job: Job
): Promise<{ ticketsGenerated: number; bookingId: number }> => {
  // Dynamic import to avoid circular deps
  const db = (await import("../../lib/db")).default;
  const { emitToAll } = await import("../../lib/socket");

  const { bookingId, bookingReference, seats } = data;
  let generated = 0;

  // Generate QR codes and insert tickets in a transaction
  await db.tx(async (t: any) => {
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i];
      const ticketId = generateTicketId(bookingReference, seat.seatLabel);

      // Generate QR code
      const qrCode = await generateQRCode(ticketId);

      // Insert into tickets table
      await t.none(
        `INSERT INTO tickets
          (booking_id, seat_id, ticket_id, seat_label, seat_type_name, price_paid,
           qr_code, status, generated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'generated', CURRENT_TIMESTAMP)
         ON CONFLICT (ticket_id) DO UPDATE
           SET qr_code = EXCLUDED.qr_code,
               status = 'generated',
               generated_at = CURRENT_TIMESTAMP`,
        [
          bookingId,
          seat.seatId,
          ticketId,
          seat.seatLabel,
          seat.seatTypeName,
          seat.pricePaid,
          qrCode,
        ]
      );

      generated++;

      // Report progress (BullMQ feature — clients can poll this)
      await job.updateProgress(Math.round(((i + 1) / seats.length) * 100));
    }
  });

  const duration = Date.now() - (job.processedOn || Date.now());
  console.log(
    `✅ [${JOBS.GENERATE_TICKETS}] ${generated} tickets generated for booking ${bookingId} in ${duration}ms`
  );

  // Notify via WebSocket that tickets are ready
  try {
    emitToAll("tickets:ready", {
      bookingId,
      bookingReference,
      ticketCount: generated,
      userId: data.userId,
    });
  } catch {
    // Non-fatal — user can poll
  }

  // Chain: dispatch email + SMS delivery jobs
  if (ticketQueue && data.user?.email) {
    await ticketQueue.add(
      JOBS.SEND_EMAIL,
      {
        bookingId,
        userId: data.userId,
        email: data.user.email,
        userName: data.user.name,
        bookingReference,
        eventName: data.event.name,
        ticketCount: generated,
      } as EmailJobData,
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
        delay: 2000, // Small delay to let tickets commit
      }
    );
  }

  if (ticketQueue && data.user?.phone) {
    await ticketQueue.add(
      JOBS.SEND_SMS,
      {
        bookingId,
        userId: data.userId,
        phone: data.user.phone,
        userName: data.user.name,
        bookingReference,
        eventName: data.event.name,
        ticketCount: generated,
      } as SmsJobData,
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 15_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
        delay: 5000,
      }
    );
  }

  return { ticketsGenerated: generated, bookingId };
};

/**
 * Send ticket email (placeholder — integrate with your email provider)
 */
const handleSendEmail = async (data: EmailJobData): Promise<{ sent: boolean }> => {
  const db = (await import("../../lib/db")).default;

  console.log(
    `📧 Sending ticket email to ${data.email} for booking ${data.bookingReference} ` +
    `(${data.ticketCount} tickets)`
  );

  // TODO: Replace with actual email service (SendGrid, SES, Resend, etc.)
  // Example:
  // await emailService.send({
  //   to: data.email,
  //   subject: `Your tickets for ${data.eventName}`,
  //   template: "ticket-confirmation",
  //   data: { userName: data.userName, bookingRef: data.bookingReference, ... }
  // });

  // For now, mark tickets as delivered (email)
  await db.none(
    `UPDATE tickets SET email_sent = TRUE, delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP)
     WHERE booking_id = $1`,
    [data.bookingId]
  );

  console.log(`✅ [send-ticket-email] Email marked for booking ${data.bookingReference}`);
  return { sent: true };
};

/**
 * Send ticket SMS (placeholder — integrate with Twilio)
 */
const handleSendSms = async (data: SmsJobData): Promise<{ sent: boolean }> => {
  const db = (await import("../../lib/db")).default;

  console.log(
    `📱 Sending ticket SMS to ${data.phone} for booking ${data.bookingReference}`
  );

  // TODO: Replace with actual Twilio SMS
  // Example:
  // const twilioClient = (await import("../services/twilio")).default;
  // await twilioClient.messages.create({
  //   body: `Hi ${data.userName}! Your ${data.ticketCount} ticket(s) for ${data.eventName} are confirmed. Ref: ${data.bookingReference}`,
  //   from: process.env.TWILIO_PHONE_NUMBER,
  //   to: data.phone,
  // });

  // Mark tickets as delivered (SMS)
  await db.none(
    `UPDATE tickets SET sms_sent = TRUE, delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP)
     WHERE booking_id = $1`,
    [data.bookingId]
  );

  console.log(`✅ [send-ticket-sms] SMS marked for booking ${data.bookingReference}`);
  return { sent: true };
};

// ════════════════════════════════════════════════════════════
//  Queue Lifecycle
// ════════════════════════════════════════════════════════════

/**
 * Start the ticket generation queue + worker
 */
export const startTicketQueue = async (): Promise<void> => {
  if (ticketWorker) {
    console.log("ℹ️  Ticket queue already running — skipping");
    return;
  }

  const connection = getRedisConnection();

  ticketQueue = new Queue(TICKET_QUEUE, { connection });

  ticketWorker = new Worker(TICKET_QUEUE, processTicketJob, {
    connection,
    concurrency: 3, // 3 bookings can generate tickets in parallel
  });

  ticketQueueEvents = new QueueEvents(TICKET_QUEUE, { connection });

  ticketWorker.on("completed", (job: Job) => {
    // Logged inside handler
  });

  ticketWorker.on("failed", (job: Job | undefined, err: Error) => {
    console.error(
      `⚠️ [${job?.name}] Ticket job failed (attempt ${job?.attemptsMade}/${job?.opts?.attempts}):`,
      err.message
    );
  });

  ticketWorker.on("error", (err: Error) => {
    console.error("❌ Ticket worker error:", err.message);
  });

  console.log("🎫 Ticket generation queue started (concurrency: 3)");
};

/**
 * Stop the ticket queue gracefully
 */
export const stopTicketQueue = async (): Promise<void> => {
  console.log("🛑 Stopping ticket queue...");
  try {
    if (ticketWorker) {
      await ticketWorker.close();
      ticketWorker = null;
    }
    if (ticketQueueEvents) {
      await ticketQueueEvents.close();
      ticketQueueEvents = null;
    }
    if (ticketQueue) {
      await ticketQueue.close();
      ticketQueue = null;
    }
    console.log("✅ Ticket queue stopped");
  } catch (err: any) {
    console.error("❌ Error stopping ticket queue:", err.message);
  }
};

// ════════════════════════════════════════════════════════════
//  Public API — used by bookings/service.ts
// ════════════════════════════════════════════════════════════

/**
 * Dispatch a ticket generation job (called from confirmBooking)
 *
 * Returns immediately — tickets generated async by worker.
 */
export const dispatchTicketGeneration = async (
  data: TicketJobData
): Promise<{ jobId: string; status: string }> => {
  if (!ticketQueue) {
    // Fallback: generate synchronously if queue not started
    console.warn("⚠️ Ticket queue not started — generating synchronously");
    return { jobId: "sync", status: "sync-fallback" };
  }

  const job = await ticketQueue.add(JOBS.GENERATE_TICKETS, data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 },
    priority: 1, // High priority
  });

  console.log(
    `🎫 Ticket generation queued: booking ${data.bookingId} ` +
    `(${data.seats.length} seats, jobId: ${job.id})`
  );

  return { jobId: job.id!, status: "queued" };
};

/**
 * Get ticket generation job status (for polling)
 */
export const getTicketJobStatus = async (
  jobId: string
): Promise<{
  status: string;
  progress: number;
  result: any;
} | null> => {
  if (!ticketQueue) return null;

  const job = await ticketQueue.getJob(jobId);
  if (!job) return null;

  const state = await job.getState();
  const progress = typeof job.progress === "number" ? job.progress : 0;

  return {
    status: state,
    progress,
    result: job.returnvalue || null,
  };
};

/**
 * Get generated tickets for a booking from DB
 */
export const getBookingTickets = async (
  bookingId: number
): Promise<any[]> => {
  const db = (await import("../../lib/db")).default;

  return db.manyOrNone(
    `SELECT
       id, ticket_id, seat_label, seat_type_name, price_paid,
       qr_code, status, email_sent, sms_sent,
       generated_at, delivered_at
     FROM tickets
     WHERE booking_id = $1
     ORDER BY seat_label`,
    [bookingId]
  );
};

/**
 * Get queue stats for monitoring
 */
export const getTicketQueueStats = async (): Promise<{
  running: boolean;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
} | null> => {
  if (!ticketQueue) return null;

  const [waiting, active, completed, failed] = await Promise.all([
    ticketQueue.getWaitingCount(),
    ticketQueue.getActiveCount(),
    ticketQueue.getCompletedCount(),
    ticketQueue.getFailedCount(),
  ]);

  return { running: !!ticketWorker, waiting, active, completed, failed };
};


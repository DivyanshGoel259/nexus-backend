import { Queue, Worker, QueueEvents, Job } from "bullmq";
import dotenv from "dotenv";

dotenv.config();

/**
 * BullMQ Cleanup Jobs
 *
 * Automated, reliable scheduled jobs for:
 *  1. Expired Seat Lock Cleanup   — every 5 minutes
 *  2. Expired Token Cleanup       — every 1 hour
 *
 * Uses the same Redis instance as the rest of the app.
 * BullMQ guarantees:
 *  - At-most-once execution per schedule tick (even with multiple server replicas)
 *  - Automatic retries on failure (3 attempts, exponential backoff)
 *  - Job deduplication via repeatable job keys
 *  - Persistent job history in Redis
 */

// ── Redis connection config (reuse env vars) ──
const getRedisConnection = () => {
  if (process.env.REDIS_URL) {
    // Parse REDIS_URL for BullMQ (it needs host/port/password separately)
    const url = new URL(process.env.REDIS_URL);
    return {
      host: url.hostname,
      port: parseInt(url.port || "6379"),
      password: url.password || undefined,
      username: url.username !== "default" ? url.username : undefined,
      maxRetriesPerRequest: null as unknown as number, // BullMQ requirement
    };
  }

  return {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null as unknown as number,
  };
};

// ── Queue Names ──
const CLEANUP_QUEUE = "cleanup-jobs";

// ── Job Names ──
const JOBS = {
  EXPIRED_LOCKS: "cleanup:expired-locks",
  EXPIRED_TOKENS: "cleanup:expired-tokens",
} as const;

// ── Queue Instance ──
let cleanupQueue: Queue | null = null;
let cleanupWorker: Worker | null = null;
let queueEvents: QueueEvents | null = null;

/**
 * Process cleanup jobs
 */
const processCleanupJob = async (job: Job): Promise<any> => {
  const startTime = Date.now();
  console.log(`🔧 [${job.name}] Starting... (attempt ${job.attemptsMade + 1})`);

  try {
    switch (job.name) {
      case JOBS.EXPIRED_LOCKS: {
        // Dynamic import to avoid circular dependencies & keep module lazy
        const { cleanupExpiredLocks } = await import("../../seats/service");
        const result = await cleanupExpiredLocks();
        const duration = Date.now() - startTime;
        console.log(
          `✅ [${job.name}] Completed in ${duration}ms — ` +
          `${result.released_locks} locks released, ${result.restored_seats} seats restored`
        );
        return result;
      }

      case JOBS.EXPIRED_TOKENS: {
        const { cleanupExpiredTokens } = await import("../helpers/tokenCleanup");
        const result = await cleanupExpiredTokens();
        const duration = Date.now() - startTime;
        console.log(
          `✅ [${job.name}] Completed in ${duration}ms — ` +
          `${result.blacklistedTokensDeleted} blacklisted, ${result.refreshTokensDeleted} refresh tokens deleted`
        );
        return result;
      }

      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  } catch (err: any) {
    const duration = Date.now() - startTime;
    console.error(`❌ [${job.name}] Failed after ${duration}ms:`, err.message);
    throw err; // BullMQ will retry based on config
  }
};

/**
 * Initialize BullMQ cleanup queue and worker
 *
 * Call once on server startup.
 * Safe to call multiple times (idempotent — skips if already running).
 */
export const startCleanupJobs = async (): Promise<void> => {
  if (cleanupWorker) {
    console.log("ℹ️  Cleanup jobs already running — skipping");
    return;
  }

  const connection = getRedisConnection();

  // 1. Create Queue
  cleanupQueue = new Queue(CLEANUP_QUEUE, { connection });

  // 2. Register repeatable jobs (BullMQ deduplicates by job name + cron pattern)

  // ── Expired Seat Locks: every 5 minutes ──
  await cleanupQueue.add(
    JOBS.EXPIRED_LOCKS,
    { description: "Cleanup expired seat locks and restore available_quantity" },
    {
      repeat: { pattern: "*/5 * * * *" }, // cron: every 5 min
      removeOnComplete: { count: 50 },     // keep last 50 completed
      removeOnFail: { count: 100 },        // keep last 100 failed
      attempts: 3,                         // retry 3 times
      backoff: {
        type: "exponential",
        delay: 5000,                       // 5s → 10s → 20s
      },
    }
  );

  // ── Expired Tokens: every 1 hour ──
  await cleanupQueue.add(
    JOBS.EXPIRED_TOKENS,
    { description: "Cleanup expired blacklisted + refresh tokens" },
    {
      repeat: { pattern: "0 * * * *" },    // cron: top of every hour
      removeOnComplete: { count: 24 },     // keep 24 hours of history
      removeOnFail: { count: 48 },
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 10000,                      // 10s → 20s → 40s
      },
    }
  );

  // 3. Create Worker (processes jobs from the queue)
  cleanupWorker = new Worker(
    CLEANUP_QUEUE,
    processCleanupJob,
    {
      connection,
      concurrency: 1,           // one job at a time (cleanup shouldn't overlap)
      limiter: {
        max: 1,
        duration: 30_000,       // max 1 job per 30 seconds (rate limit safety)
      },
    }
  );

  // 4. Queue Events (logging)
  queueEvents = new QueueEvents(CLEANUP_QUEUE, { connection });

  // ── Worker event handlers ──
  cleanupWorker.on("completed", (job: Job) => {
    // Already logged in processCleanupJob
  });

  cleanupWorker.on("failed", (job: Job | undefined, err: Error) => {
    console.error(`⚠️ [${job?.name}] Job failed (attempt ${job?.attemptsMade}/${job?.opts?.attempts}):`, err.message);
  });

  cleanupWorker.on("error", (err: Error) => {
    console.error("❌ Cleanup worker error:", err.message);
  });

  console.log("🚀 Cleanup jobs started:");
  console.log("   ⏰ Expired locks cleanup  — every 5 minutes (*/5 * * * *)");
  console.log("   ⏰ Expired tokens cleanup — every hour      (0 * * * *)");
};

/**
 * Stop all cleanup jobs gracefully
 *
 * Call on server shutdown (SIGTERM / SIGINT).
 */
export const stopCleanupJobs = async (): Promise<void> => {
  console.log("🛑 Stopping cleanup jobs...");

  try {
    if (cleanupWorker) {
      await cleanupWorker.close();
      cleanupWorker = null;
    }
    if (queueEvents) {
      await queueEvents.close();
      queueEvents = null;
    }
    if (cleanupQueue) {
      await cleanupQueue.close();
      cleanupQueue = null;
    }
    console.log("✅ Cleanup jobs stopped");
  } catch (err: any) {
    console.error("❌ Error stopping cleanup jobs:", err.message);
  }
};

/**
 * Get status of all cleanup jobs (for health checks / admin API)
 */
export const getCleanupJobStatus = async (): Promise<{
  running: boolean;
  jobs: {
    name: string;
    nextRun: string | null;
    lastRun: string | null;
    repeatPattern: string;
  }[];
}> => {
  if (!cleanupQueue) {
    return { running: false, jobs: [] };
  }

  const repeatableJobs = await cleanupQueue.getRepeatableJobs();

  return {
    running: !!cleanupWorker,
    jobs: repeatableJobs.map((job) => ({
      name: job.name,
      nextRun: job.next ? new Date(job.next).toISOString() : null,
      lastRun: null, // BullMQ doesn't expose this directly on repeatable
      repeatPattern: job.pattern || "unknown",
    })),
  };
};

/**
 * Manually trigger a cleanup job (for admin / testing)
 */
export const triggerCleanupNow = async (
  type: "locks" | "tokens"
): Promise<string> => {
  if (!cleanupQueue) {
    throw new Error("Cleanup queue not initialized — call startCleanupJobs() first");
  }

  const jobName = type === "locks" ? JOBS.EXPIRED_LOCKS : JOBS.EXPIRED_TOKENS;

  const job = await cleanupQueue.add(
    jobName,
    { description: `Manual trigger: ${type}`, manual: true },
    {
      attempts: 1,
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
    }
  );

  console.log(`🔧 Manual cleanup triggered: ${jobName} (jobId: ${job.id})`);
  return job.id!;
};


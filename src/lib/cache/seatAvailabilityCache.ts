import redis from "../services/redis";
import db from "../db";

/**
 * Redis Seat Availability Cache
 * 
 * Caches available_quantity per seat type to avoid DB hits on every request
 * Synced with WebSocket broadcasts for real-time updates
 * 
 * Key Format: `seat_availability:{eventId}:{seatTypeId}`
 * Value: available_count (string number)
 * TTL: 60 seconds (auto-refresh on miss)
 * 
 * Performance:
 * - Redis GET: <1ms vs DB query: 5-20ms
 * - Atomic INCR/DECR for lock/unlock operations
 */

const SEAT_AVAIL_PREFIX = "seat_availability:";
const SEAT_AVAIL_TTL = 60; // 60 seconds

// ============================================================
// Core Cache Operations
// ============================================================

/**
 * Get cached seat availability (Redis → DB fallback)
 * 
 * @param eventId - Event ID
 * @param seatTypeId - Seat type ID
 * @returns available_quantity (number) or null if seat type not found
 */
export const getCachedSeatAvailability = async (
  eventId: number,
  seatTypeId: number
): Promise<number | null> => {
  const key = `${SEAT_AVAIL_PREFIX}${eventId}:${seatTypeId}`;

  try {
    // 1. Try Redis first (fast path)
    const cached = await redis.get(key);
    if (cached !== null) {
      return parseInt(cached, 10);
    }
  } catch (err) {
    console.error(`⚠️ Redis GET failed for seat availability ${key}:`, err);
    // Fall through to DB
  }

  // 2. Cache miss → fetch from DB and populate cache
  try {
    const row = await db.oneOrNone(
      `SELECT available_quantity 
       FROM event_seat_types 
       WHERE id = $1 AND event_id = $2`,
      [seatTypeId, eventId]
    );

    if (!row) return null;

    const count = parseInt(row.available_quantity, 10);

    // Populate cache for next request
    try {
      await redis.set(key, count.toString(), "EX", SEAT_AVAIL_TTL);
    } catch (cacheErr) {
      console.error(`⚠️ Redis SET failed for seat availability ${key}:`, cacheErr);
    }

    return count;
  } catch (dbErr) {
    console.error(`❌ DB query failed for seat availability:`, dbErr);
    throw dbErr;
  }
};

/**
 * Get availability for ALL seat types of an event (batch)
 * 
 * @param eventId - Event ID
 * @returns Map of seatTypeId → available_quantity
 */
export const getCachedEventAvailability = async (
  eventId: number
): Promise<Map<number, number>> => {
  const result = new Map<number, number>();

  try {
    // Get all seat types for this event from DB
    const seatTypes = await db.manyOrNone(
      `SELECT id, available_quantity 
       FROM event_seat_types 
       WHERE event_id = $1`,
      [eventId]
    );

    if (!seatTypes || seatTypes.length === 0) return result;

    // Build Redis keys
    const keys = seatTypes.map((st: any) => `${SEAT_AVAIL_PREFIX}${eventId}:${st.id}`);

    // Try Redis MGET for all at once
    let cachedValues: (string | null)[] = [];
    try {
      cachedValues = await redis.mget(...keys);
    } catch (err) {
      console.error(`⚠️ Redis MGET failed for event ${eventId} availability:`, err);
      // Fall through to DB values
    }

    // Build result + populate cache misses
    const pipeline = redis.pipeline();
    let pipelineHasCommands = false;

    for (let i = 0; i < seatTypes.length; i++) {
      const st = seatTypes[i];
      const seatTypeId = parseInt(st.id, 10);

      if (cachedValues[i] !== null && cachedValues[i] !== undefined) {
        // Cache hit
        result.set(seatTypeId, parseInt(cachedValues[i]!, 10));
      } else {
        // Cache miss → use DB value and populate cache
        const dbCount = parseInt(st.available_quantity, 10);
        result.set(seatTypeId, dbCount);
        pipeline.set(keys[i], dbCount.toString(), "EX", SEAT_AVAIL_TTL);
        pipelineHasCommands = true;
      }
    }

    // Execute pipeline for cache misses
    if (pipelineHasCommands) {
      try {
        await pipeline.exec();
      } catch (err) {
        console.error(`⚠️ Redis pipeline failed for event ${eventId} availability:`, err);
      }
    }

    return result;
  } catch (err) {
    console.error(`❌ Failed to get event availability:`, err);
    throw err;
  }
};

/**
 * Set seat availability in cache (explicit set)
 * Used after DB updates to keep cache in sync
 */
export const setCachedSeatAvailability = async (
  eventId: number,
  seatTypeId: number,
  count: number
): Promise<void> => {
  const key = `${SEAT_AVAIL_PREFIX}${eventId}:${seatTypeId}`;
  try {
    await redis.set(key, Math.max(0, count).toString(), "EX", SEAT_AVAIL_TTL);
  } catch (err) {
    console.error(`⚠️ Redis SET failed for seat availability ${key}:`, err);
    // Non-fatal — DB is source of truth
  }
};

/**
 * Atomic decrement seat availability (after seat lock)
 * Returns new count, or null if key doesn't exist in cache
 * 
 * ⚠️ If key not in cache, fetches from DB first
 */
export const decrementSeatAvailability = async (
  eventId: number,
  seatTypeId: number
): Promise<number> => {
  const key = `${SEAT_AVAIL_PREFIX}${eventId}:${seatTypeId}`;

  try {
    // Check if key exists in cache
    const exists = await redis.exists(key);

    if (exists) {
      // Atomic DECR — Redis guarantees no race condition
      const newCount = await redis.decr(key);
      // Ensure non-negative (safety check)
      if (newCount < 0) {
        await redis.set(key, "0", "EX", SEAT_AVAIL_TTL);
        return 0;
      }
      // Refresh TTL
      await redis.expire(key, SEAT_AVAIL_TTL);
      return newCount;
    }
  } catch (err) {
    console.error(`⚠️ Redis DECR failed for ${key}:`, err);
  }

  // Key not in cache — fetch fresh from DB (DB already decremented by service)
  const row = await db.oneOrNone(
    `SELECT available_quantity FROM event_seat_types WHERE id = $1 AND event_id = $2`,
    [seatTypeId, eventId]
  );

  const count = row ? parseInt(row.available_quantity, 10) : 0;

  try {
    await redis.set(key, count.toString(), "EX", SEAT_AVAIL_TTL);
  } catch (err) {
    console.error(`⚠️ Redis SET failed after DB fallback for ${key}:`, err);
  }

  return count;
};

/**
 * Atomic increment seat availability (after seat unlock/cancel)
 * Returns new count
 */
export const incrementSeatAvailability = async (
  eventId: number,
  seatTypeId: number
): Promise<number> => {
  const key = `${SEAT_AVAIL_PREFIX}${eventId}:${seatTypeId}`;

  try {
    const exists = await redis.exists(key);

    if (exists) {
      const newCount = await redis.incr(key);
      await redis.expire(key, SEAT_AVAIL_TTL);
      return newCount;
    }
  } catch (err) {
    console.error(`⚠️ Redis INCR failed for ${key}:`, err);
  }

  // Key not in cache — fetch fresh from DB
  const row = await db.oneOrNone(
    `SELECT available_quantity FROM event_seat_types WHERE id = $1 AND event_id = $2`,
    [seatTypeId, eventId]
  );

  const count = row ? parseInt(row.available_quantity, 10) : 0;

  try {
    await redis.set(key, count.toString(), "EX", SEAT_AVAIL_TTL);
  } catch (err) {
    console.error(`⚠️ Redis SET failed after DB fallback for ${key}:`, err);
  }

  return count;
};

/**
 * Invalidate seat availability cache (force next read to hit DB)
 * Use after bulk operations, cleanup, or when cache might be stale
 */
export const invalidateSeatAvailability = async (
  eventId: number,
  seatTypeId: number
): Promise<void> => {
  const key = `${SEAT_AVAIL_PREFIX}${eventId}:${seatTypeId}`;
  try {
    await redis.del(key);
  } catch (err) {
    console.error(`⚠️ Redis DEL failed for ${key}:`, err);
  }
};

/**
 * Invalidate ALL seat availability cache for an event
 * Use after event deletion or bulk seat operations
 */
export const invalidateEventAvailability = async (
  eventId: number
): Promise<void> => {
  try {
    const seatTypes = await db.manyOrNone(
      `SELECT id FROM event_seat_types WHERE event_id = $1`,
      [eventId]
    );

    if (!seatTypes || seatTypes.length === 0) return;

    const keys = seatTypes.map((st: any) => `${SEAT_AVAIL_PREFIX}${eventId}:${st.id}`);
    await redis.del(...keys);
  } catch (err) {
    console.error(`⚠️ Failed to invalidate event ${eventId} availability cache:`, err);
  }
};

/**
 * Get cache stats for monitoring
 */
export const getSeatAvailabilityCacheStats = async (): Promise<{
  prefix: string;
  ttl: number;
  description: string;
}> => {
  return {
    prefix: SEAT_AVAIL_PREFIX,
    ttl: SEAT_AVAIL_TTL,
    description: "Seat availability cache — 60s TTL, auto-refresh on miss",
  };
};


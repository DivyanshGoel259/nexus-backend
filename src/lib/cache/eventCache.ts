import redis from "../services/redis";
import db from "../db";

/**
 * Redis Event Details Cache
 * 
 * Caches frequently accessed event data to reduce DB load
 * 
 * Key Format: `event:{eventId}`
 * Value: JSON stringified event data
 * TTL: 300 seconds (5 minutes)
 * 
 * Performance:
 * - Redis GET + JSON.parse: 1-3ms
 * - DB query with JOINs: 10-50ms
 * - 5-15x faster for repeat reads
 */

const EVENT_PREFIX = "event:";
const EVENT_TTL = 300; // 5 minutes
const EVENT_LIST_KEY = "events:list";
const EVENT_LIST_TTL = 120; // 2 minutes for list cache (staler is OK)

interface CachedEvent {
  id: number;
  name: string;
  description: string;
  start_date: string;
  end_date: string;
  image_url: string | null;
  location: string;
  venue_name: string | null;
  organizer_id: number;
  organizer_name: string;
  organizer_email?: string;
  status: string;
  is_public: boolean;
  max_tickets_per_user: number;
  created_at: string;
  updated_at: string;
  total_seats: number;
  available_seats: number;
  booked_seats: number;
  occupancy_rate: string;
}

// ============================================================
// Single Event Cache
// ============================================================

/**
 * Get cached event by ID (Redis → DB fallback)
 * 
 * @param eventId - Event ID
 * @returns Event data or null if not found
 */
export const getCachedEvent = async (
  eventId: number
): Promise<CachedEvent | null> => {
  const key = `${EVENT_PREFIX}${eventId}`;

  // 1. Try Redis first
  try {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached) as CachedEvent;
    }
  } catch (err) {
    console.error(`⚠️ Redis GET failed for event ${eventId}:`, err);
  }

  // 2. Cache miss → fetch from DB
  try {
    const event = await db.oneOrNone(
      `SELECT 
        e.id, e.name, e.description, e.start_date, e.end_date, e.image_url,
        e.location, e.venue_name, e.organizer_id, e.status, e.is_public,
        e.max_tickets_per_user, e.created_at, e.updated_at,
        u.name as organizer_name, u.email as organizer_email,
        COALESCE(SUM(est.quantity), 0)::INTEGER as total_seats,
        COALESCE(SUM(est.available_quantity), 0)::INTEGER as available_seats,
        COALESCE(SUM(est.quantity - est.available_quantity), 0)::INTEGER as booked_seats
      FROM events e
      LEFT JOIN users u ON e.organizer_id = u.id
      LEFT JOIN event_seat_types est ON e.id = est.event_id
      WHERE e.id = $1
      GROUP BY e.id, e.name, e.description, e.start_date, e.end_date, e.image_url,
               e.location, e.venue_name, e.organizer_id, e.status, e.is_public,
               e.max_tickets_per_user, e.created_at, e.updated_at, u.name, u.email`,
      [eventId]
    );

    if (!event) return null;

    const totalSeats = parseInt(event.total_seats || "0");
    const availableSeats = parseInt(event.available_seats || "0");
    const bookedSeats = parseInt(event.booked_seats || "0");

    const cachedEvent: CachedEvent = {
      id: event.id,
      name: event.name,
      description: event.description,
      start_date: event.start_date,
      end_date: event.end_date,
      image_url: event.image_url,
      location: event.location,
      venue_name: event.venue_name,
      organizer_id: event.organizer_id,
      organizer_name: event.organizer_name,
      organizer_email: event.organizer_email,
      status: event.status,
      is_public: event.is_public,
      max_tickets_per_user: event.max_tickets_per_user,
      created_at: event.created_at,
      updated_at: event.updated_at,
      total_seats: totalSeats,
      available_seats: availableSeats,
      booked_seats: bookedSeats,
      occupancy_rate: totalSeats > 0 ? ((bookedSeats / totalSeats) * 100).toFixed(2) : "0.00",
    };

    // Populate cache
    try {
      await redis.set(key, JSON.stringify(cachedEvent), "EX", EVENT_TTL);
    } catch (cacheErr) {
      console.error(`⚠️ Redis SET failed for event ${eventId}:`, cacheErr);
    }

    return cachedEvent;
  } catch (dbErr) {
    console.error(`❌ DB query failed for event ${eventId}:`, dbErr);
    throw dbErr;
  }
};

/**
 * Set event in cache (explicit set after create/update)
 */
export const setCachedEvent = async (
  eventId: number,
  eventData: CachedEvent
): Promise<void> => {
  const key = `${EVENT_PREFIX}${eventId}`;
  try {
    await redis.set(key, JSON.stringify(eventData), "EX", EVENT_TTL);
  } catch (err) {
    console.error(`⚠️ Redis SET failed for event ${eventId}:`, err);
  }
};

/**
 * Invalidate single event cache
 * Use after event update/delete to force fresh DB read
 */
export const invalidateEventCache = async (
  eventId: number
): Promise<void> => {
  const key = `${EVENT_PREFIX}${eventId}`;
  try {
    await redis.del(key);
    // Also invalidate list cache (it may contain stale data for this event)
    await redis.del(EVENT_LIST_KEY);
  } catch (err) {
    console.error(`⚠️ Redis DEL failed for event ${eventId}:`, err);
  }
};

// ============================================================
// Event List Cache
// ============================================================

/**
 * Get cached event list
 * 
 * Note: Only caches the default (no filter) list to avoid key explosion
 * Filtered queries always go to DB
 * 
 * @param options - Filter/pagination options
 * @returns Cached events + pagination, or null if cache miss
 */
export const getCachedEventList = async (
  options?: {
    status?: string;
    is_public?: boolean;
    organizer_id?: number;
    limit?: number;
    offset?: number;
  }
): Promise<{ events: any[]; pagination: any } | null> => {
  // Only cache default list (no filters, first page)
  // Filtered/paginated queries go straight to DB
  const hasFilters = options?.status || options?.is_public !== undefined || options?.organizer_id;
  const isFirstPage = !options?.offset || options.offset === 0;
  const defaultLimit = !options?.limit || options.limit === 10;

  if (hasFilters || !isFirstPage || !defaultLimit) {
    return null; // Skip cache for filtered/paginated queries
  }

  try {
    const cached = await redis.get(EVENT_LIST_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    console.error(`⚠️ Redis GET failed for event list:`, err);
  }

  return null; // Cache miss
};

/**
 * Set event list in cache (only default list)
 */
export const setCachedEventList = async (
  data: { events: any[]; pagination: any },
  options?: {
    status?: string;
    is_public?: boolean;
    organizer_id?: number;
    limit?: number;
    offset?: number;
  }
): Promise<void> => {
  // Only cache default list
  const hasFilters = options?.status || options?.is_public !== undefined || options?.organizer_id;
  const isFirstPage = !options?.offset || options.offset === 0;
  const defaultLimit = !options?.limit || options.limit === 10;

  if (hasFilters || !isFirstPage || !defaultLimit) {
    return; // Don't cache filtered/paginated queries
  }

  try {
    await redis.set(EVENT_LIST_KEY, JSON.stringify(data), "EX", EVENT_LIST_TTL);
  } catch (err) {
    console.error(`⚠️ Redis SET failed for event list:`, err);
  }
};

/**
 * Invalidate event list cache
 * Use after any event create/update/delete
 */
export const invalidateEventListCache = async (): Promise<void> => {
  try {
    await redis.del(EVENT_LIST_KEY);
  } catch (err) {
    console.error(`⚠️ Redis DEL failed for event list:`, err);
  }
};

// ============================================================
// Batch Operations
// ============================================================

/**
 * Warm up cache for popular events (call on startup or schedule)
 * 
 * @param eventIds - Array of event IDs to pre-cache
 */
export const warmUpEventCache = async (
  eventIds: number[]
): Promise<{ cached: number; failed: number }> => {
  let cached = 0;
  let failed = 0;

  for (const eventId of eventIds) {
    try {
      const event = await getCachedEvent(eventId);
      if (event) cached++;
      else failed++;
    } catch {
      failed++;
    }
  }

  console.log(`🔥 Event cache warmed: ${cached} cached, ${failed} failed`);
  return { cached, failed };
};

/**
 * Invalidate ALL event caches (nuclear option)
 * Use for cache reset or emergency
 */
export const invalidateAllEventCache = async (): Promise<number> => {
  try {
    // Delete list cache
    await redis.del(EVENT_LIST_KEY);

    // Find and delete all event:* keys
    let cursor = "0";
    let deletedCount = 0;

    do {
      const [newCursor, keys] = await redis.scan(
        cursor, "MATCH", `${EVENT_PREFIX}*`, "COUNT", 100
      );
      cursor = newCursor;

      if (keys.length > 0) {
        await redis.del(...keys);
        deletedCount += keys.length;
      }
    } while (cursor !== "0");

    console.log(`🗑️ Invalidated ${deletedCount} event cache entries`);
    return deletedCount;
  } catch (err) {
    console.error(`❌ Failed to invalidate all event caches:`, err);
    return 0;
  }
};

/**
 * Get cache stats for monitoring
 */
export const getEventCacheStats = async (): Promise<{
  prefix: string;
  ttl: number;
  listTtl: number;
  description: string;
}> => {
  return {
    prefix: EVENT_PREFIX,
    ttl: EVENT_TTL,
    listTtl: EVENT_LIST_TTL,
    description: "Event details cache — 5min TTL for details, 2min for list",
  };
};


/**
 * Redis Cache Module
 * 
 * Fast O(1) caching for:
 * - JWT token blacklist
 * - Refresh token validation
 * - Seat locks (active)
 * - User sessions (future)
 * 
 * Export all cache utilities
 */

// Token Cache
export {
  blacklistToken,
  isTokenBlacklisted,
  cacheRefreshToken,
  getCachedRefreshToken,
  invalidateRefreshToken,
  revokeAllUserTokens,
  cleanupExpiredTokenCache,
  getTokenCacheStats,
} from "./tokenCache";

// Seat Lock Cache
export {
  acquireSeatLock,
  getSeatLock,
  releaseSeatLock,
  batchCheckSeatLocks,
  getUserLockedSeats,
  cleanupExpiredSeatLocks,
  getSeatLockStats,
  extendSeatLock,
} from "./seatLockCache";

// Seat Availability Cache
export {
  getCachedSeatAvailability,
  getCachedEventAvailability,
  setCachedSeatAvailability,
  decrementSeatAvailability,
  incrementSeatAvailability,
  invalidateSeatAvailability,
  invalidateEventAvailability,
  getSeatAvailabilityCacheStats,
} from "./seatAvailabilityCache";

// Event Details Cache
export {
  getCachedEvent,
  setCachedEvent,
  invalidateEventCache,
  getCachedEventList,
  setCachedEventList,
  invalidateEventListCache,
  warmUpEventCache,
  invalidateAllEventCache,
  getEventCacheStats,
} from "./eventCache";

// Future exports:
// export * from "./sessionCache";


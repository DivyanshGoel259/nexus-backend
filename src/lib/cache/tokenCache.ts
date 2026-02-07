import redis from "../services/redis";
import db from "../db";

/**
 * Redis Token Cache Service
 * 
 * Fast O(1) token blacklist lookup using Redis
 * Falls back to database if Redis is unavailable
 * 
 * Key Format: `blacklist:${token}`
 * Value Format: JSON stringified { userId, expiresAt }
 */

const TOKEN_BLACKLIST_PREFIX = "blacklist:";
const REFRESH_TOKEN_PREFIX = "refresh_token:";

/**
 * Add token to blacklist (Redis + DB for redundancy)
 * 
 * @param token - JWT token to blacklist
 * @param userId - User ID who owns the token
 * @param expiresAt - Token expiry date
 */
export const blacklistToken = async (
  token: string,
  userId: number,
  expiresAt: Date
): Promise<void> => {
  try {
    const expiresAtTime = new Date(expiresAt).getTime();
    const now = Date.now();
    const ttlSeconds = Math.max(0, Math.floor((expiresAtTime - now) / 1000));

    // If token already expired, no need to blacklist
    if (ttlSeconds <= 0) {
      console.log(`Token already expired, skipping blacklist`);
      return;
    }

    const cacheKey = `${TOKEN_BLACKLIST_PREFIX}${token}`;
    const cacheValue = JSON.stringify({
      userId,
      expiresAt: expiresAt.toISOString(),
      blacklistedAt: new Date().toISOString(),
    });

    // 1. Add to Redis with TTL (automatic expiry)
    try {
      await redis.setex(cacheKey, ttlSeconds, cacheValue);
      console.log(`✅ Token blacklisted in Redis (TTL: ${ttlSeconds}s)`);
    } catch (redisErr: any) {
      console.error("⚠️ Redis blacklist failed:", redisErr.message);
      // Continue to DB fallback
    }

    // 2. Add to Database (redundancy + persistence)
    try {
      await db.none(
        `INSERT INTO blacklisted_tokens(token, user_id, expires_at) 
         VALUES($1, $2, $3)
         ON CONFLICT (token) DO NOTHING`,
        [token, userId, expiresAt]
      );
      console.log(`✅ Token blacklisted in Database`);
    } catch (dbErr: any) {
      console.error("⚠️ Database blacklist failed:", dbErr.message);
      // Redis still has it, so not critical
    }
  } catch (err: any) {
    console.error("❌ Failed to blacklist token:", err.message);
    throw new Error(`Failed to blacklist token: ${err.message}`);
  }
};

/**
 * Check if token is blacklisted (Redis first, DB fallback)
 * 
 * @param token - JWT token to check
 * @returns true if blacklisted, false otherwise
 */
export const isTokenBlacklisted = async (token: string): Promise<boolean> => {
  try {
    const cacheKey = `${TOKEN_BLACKLIST_PREFIX}${token}`;

    // 1. Check Redis first (O(1) - FAST!)
    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null) {
        console.log(`✅ Token blacklist check: HIT (Redis)`);
        return true; // Found in Redis = Blacklisted
      }
      console.log(`✅ Token blacklist check: MISS (Redis) - Token is valid`);
      return false; // Not in Redis = Not blacklisted
    } catch (redisErr: any) {
      console.error("⚠️ Redis check failed, falling back to DB:", redisErr.message);
      // Fall through to database check
    }

    // 2. Fallback to Database (if Redis fails)
    const blacklisted = await db.oneOrNone(
      `SELECT id, expires_at FROM blacklisted_tokens 
       WHERE token = $1 AND expires_at > NOW()`,
      [token]
    );

    if (blacklisted) {
      console.log(`✅ Token blacklist check: HIT (Database)`);
      // Cache in Redis for next time (if Redis is available)
      try {
        const expiresAt = new Date(blacklisted.expires_at).getTime();
        const ttlSeconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
        if (ttlSeconds > 0) {
          await redis.setex(
            cacheKey,
            ttlSeconds,
            JSON.stringify({ cached: true })
          );
        }
      } catch (cacheErr) {
        // Ignore cache errors
      }
      return true;
    }

    console.log(`✅ Token blacklist check: MISS (Database) - Token is valid`);
    return false;
  } catch (err: any) {
    console.error("❌ Token blacklist check failed:", err.message);
    // On error, allow the token (fail open) to prevent system lockout
    // Alternative: fail closed by returning true
    return false;
  }
};

/**
 * Store refresh token in Redis cache
 * 
 * @param token - Refresh token
 * @param userId - User ID
 * @param expiresAt - Token expiry date
 */
export const cacheRefreshToken = async (
  token: string,
  userId: number,
  expiresAt: Date
): Promise<void> => {
  try {
    const expiresAtTime = new Date(expiresAt).getTime();
    const ttlSeconds = Math.max(0, Math.floor((expiresAtTime - Date.now()) / 1000));

    if (ttlSeconds <= 0) {
      return;
    }

    const cacheKey = `${REFRESH_TOKEN_PREFIX}${token}`;
    const cacheValue = JSON.stringify({
      userId,
      expiresAt: expiresAt.toISOString(),
      isRevoked: false,
    });

    await redis.setex(cacheKey, ttlSeconds, cacheValue);
    console.log(`✅ Refresh token cached (TTL: ${ttlSeconds}s)`);
  } catch (err: any) {
    console.error("⚠️ Failed to cache refresh token:", err.message);
    // Non-critical, DB still has it
  }
};

/**
 * Get refresh token from cache (Redis first, DB fallback)
 * 
 * @param token - Refresh token
 * @returns Token data or null
 */
export const getCachedRefreshToken = async (
  token: string
): Promise<{ userId: number; isRevoked: boolean; expiresAt: string } | null> => {
  try {
    const cacheKey = `${REFRESH_TOKEN_PREFIX}${token}`;

    // Check Redis first
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        console.log(`✅ Refresh token: HIT (Redis)`);
        return JSON.parse(cached);
      }
    } catch (redisErr: any) {
      console.error("⚠️ Redis get failed, falling back to DB:", redisErr.message);
    }

    // Fallback to Database
    const dbToken = await db.oneOrNone(
      `SELECT user_id, is_revoked, expires_at 
       FROM refresh_tokens 
       WHERE token = $1 AND expires_at > NOW()`,
      [token]
    );

    if (dbToken) {
      console.log(`✅ Refresh token: HIT (Database)`);
      // Cache for next time
      try {
        const expiresAt = new Date(dbToken.expires_at).getTime();
        const ttlSeconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
        if (ttlSeconds > 0) {
          await redis.setex(
            cacheKey,
            ttlSeconds,
            JSON.stringify({
              userId: dbToken.user_id,
              isRevoked: dbToken.is_revoked,
              expiresAt: dbToken.expires_at,
            })
          );
        }
      } catch (cacheErr) {
        // Ignore cache errors
      }

      return {
        userId: dbToken.user_id,
        isRevoked: dbToken.is_revoked,
        expiresAt: dbToken.expires_at,
      };
    }

    return null;
  } catch (err: any) {
    console.error("❌ Failed to get refresh token:", err.message);
    return null;
  }
};

/**
 * Invalidate refresh token in cache
 * 
 * @param token - Refresh token to invalidate
 */
export const invalidateRefreshToken = async (token: string): Promise<void> => {
  try {
    const cacheKey = `${REFRESH_TOKEN_PREFIX}${token}`;
    await redis.del(cacheKey);
    console.log(`✅ Refresh token invalidated from cache`);
  } catch (err: any) {
    console.error("⚠️ Failed to invalidate refresh token:", err.message);
    // Non-critical
  }
};

/**
 * Revoke all tokens for a user
 * 
 * @param userId - User ID
 */
export const revokeAllUserTokens = async (userId: number): Promise<void> => {
  try {
    // Get all refresh tokens for user from DB
    const tokens = await db.manyOrNone(
      `SELECT token, expires_at FROM refresh_tokens 
       WHERE user_id = $1 AND is_revoked = FALSE AND expires_at > NOW()`,
      [userId]
    );

    if (!tokens || tokens.length === 0) {
      console.log(`No active tokens found for user ${userId}`);
      return;
    }

    // Invalidate each token from Redis cache
    for (const tokenData of tokens) {
      await invalidateRefreshToken(tokenData.token);
      // Also blacklist it
      await blacklistToken(tokenData.token, userId, tokenData.expires_at);
    }

    console.log(`✅ Revoked ${tokens.length} tokens for user ${userId}`);
  } catch (err: any) {
    console.error("❌ Failed to revoke user tokens:", err.message);
    throw err;
  }
};

/**
 * Clear expired tokens from cache (cleanup job)
 * Note: Redis auto-expires with TTL, this is just for manual cleanup
 */
export const cleanupExpiredTokenCache = async (): Promise<number> => {
  try {
    // Scan for expired blacklist keys (this is a safety net, TTL should handle it)
    const pattern = `${TOKEN_BLACKLIST_PREFIX}*`;
    let cursor = "0";
    let deletedCount = 0;

    do {
      const result = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = result[0];
      const keys = result[1];

      for (const key of keys) {
        const ttl = await redis.ttl(key);
        if (ttl <= 0) {
          // Already expired or no TTL set, delete it
          await redis.del(key);
          deletedCount++;
        }
      }
    } while (cursor !== "0");

    console.log(`✅ Cleaned up ${deletedCount} expired token cache entries`);
    return deletedCount;
  } catch (err: any) {
    console.error("❌ Failed to cleanup token cache:", err.message);
    return 0;
  }
};

/**
 * Get cache statistics
 */
export const getTokenCacheStats = async (): Promise<{
  blacklistedTokens: number;
  refreshTokens: number;
}> => {
  try {
    let blacklistedCount = 0;
    let refreshCount = 0;

    // Count blacklisted tokens
    let cursor = "0";
    do {
      const result = await redis.scan(
        cursor,
        "MATCH",
        `${TOKEN_BLACKLIST_PREFIX}*`,
        "COUNT",
        100
      );
      cursor = result[0];
      blacklistedCount += result[1].length;
    } while (cursor !== "0");

    // Count refresh tokens
    cursor = "0";
    do {
      const result = await redis.scan(
        cursor,
        "MATCH",
        `${REFRESH_TOKEN_PREFIX}*`,
        "COUNT",
        100
      );
      cursor = result[0];
      refreshCount += result[1].length;
    } while (cursor !== "0");

    return {
      blacklistedTokens: blacklistedCount,
      refreshTokens: refreshCount,
    };
  } catch (err: any) {
    console.error("❌ Failed to get cache stats:", err.message);
    return { blacklistedTokens: 0, refreshTokens: 0 };
  }
};


import db from "../db";
import { cleanupExpiredTokenCache, getTokenCacheStats } from "../cache/tokenCache";

/**
 * Cleanup expired tokens from the database and Redis cache
 * This should be run periodically (e.g., daily via cron job)
 * 
 * Note: Redis tokens auto-expire with TTL, but this provides manual cleanup as backup
 */
export const cleanupExpiredTokens = async () => {
  try {
    // 1. Delete expired blacklisted tokens from database
    const deletedBlacklisted = await db.result(
      `DELETE FROM blacklisted_tokens WHERE expires_at < NOW()`,
      [],
      (r) => r.rowCount
    );

    // 2. Delete expired refresh tokens from database
    const deletedRefresh = await db.result(
      `DELETE FROM refresh_tokens WHERE expires_at < NOW()`,
      [],
      (r) => r.rowCount
    );

    // 3. Cleanup expired tokens from Redis cache (safety net, TTL should handle it)
    let cacheDeleted = 0;
    try {
      cacheDeleted = await cleanupExpiredTokenCache();
    } catch (cacheErr: any) {
      console.error("⚠️ Redis cache cleanup failed:", cacheErr.message);
    }

    // 4. Get cache statistics
    let cacheStats = { blacklistedTokens: 0, refreshTokens: 0 };
    try {
      cacheStats = await getTokenCacheStats();
    } catch (statsErr: any) {
      console.error("⚠️ Failed to get cache stats:", statsErr.message);
    }

    console.log(`✅ Cleanup completed:
      - Database: ${deletedBlacklisted} blacklisted tokens, ${deletedRefresh} refresh tokens
      - Redis: ${cacheDeleted} expired entries cleaned
      - Cache Stats: ${cacheStats.blacklistedTokens} blacklisted, ${cacheStats.refreshTokens} refresh tokens`);

    return {
      blacklistedTokensDeleted: deletedBlacklisted,
      refreshTokensDeleted: deletedRefresh,
      cacheEntriesDeleted: cacheDeleted,
      cacheStats,
    };
  } catch (err: any) {
    console.error("❌ Error during token cleanup:", err.message);
    throw err;
  }
};

/**
 * Revoke all refresh tokens for a specific user
 * Useful for security purposes (e.g., password change, account compromise)
 * 
 * This function now uses Redis cache for faster revocation
 */
export const revokeAllUserTokens = async (userId: number) => {
  try {
    // Import here to avoid circular dependency
    const { revokeAllUserTokens: revokeFromCache } = await import("../cache/tokenCache");
    
    // 1. Revoke from Redis cache first (fast)
    try {
      await revokeFromCache(userId);
    } catch (cacheErr: any) {
      console.error("⚠️ Failed to revoke from cache:", cacheErr.message);
    }

    // 2. Revoke all refresh tokens in database
    await db.none(
      `UPDATE refresh_tokens SET is_revoked = TRUE WHERE user_id = $(userId)`,
      { userId }
    );

    // 3. Get count of revoked tokens
    const revokedCount = await db.one(
      `SELECT COUNT(*) as count FROM refresh_tokens WHERE user_id = $(userId) AND is_revoked = TRUE`,
      { userId },
      (row: any) => parseInt(row.count)
    );

    console.log(`✅ All tokens revoked for user ${userId} (${revokedCount} tokens)`);

    return {
      message: `All tokens revoked for user ${userId}`,
      tokensRevoked: revokedCount,
    };
  } catch (err: any) {
    console.error("❌ Error revoking user tokens:", err.message);
    throw err;
  }
};


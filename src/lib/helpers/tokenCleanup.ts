import db from "../db";

/**
 * Cleanup expired tokens from the database
 * This should be run periodically (e.g., daily via cron job)
 */
export const cleanupExpiredTokens = async () => {
  try {
    // Delete expired blacklisted tokens
    const deletedBlacklisted = await db.result(
      `DELETE FROM blacklisted_tokens WHERE expires_at < NOW()`,
      [],
      (r) => r.rowCount
    );

    // Delete expired refresh tokens
    const deletedRefresh = await db.result(
      `DELETE FROM refresh_tokens WHERE expires_at < NOW()`,
      [],
      (r) => r.rowCount
    );

    console.log(`Cleanup completed: ${deletedBlacklisted} blacklisted tokens and ${deletedRefresh} refresh tokens removed`);

    return {
      blacklistedTokensDeleted: deletedBlacklisted,
      refreshTokensDeleted: deletedRefresh,
    };
  } catch (err: any) {
    console.error("Error during token cleanup:", err.message);
    throw err;
  }
};

/**
 * Revoke all refresh tokens for a specific user
 * Useful for security purposes (e.g., password change, account compromise)
 */
export const revokeAllUserTokens = async (userId: number) => {
  try {
    // Revoke all refresh tokens
    await db.none(
      `UPDATE refresh_tokens SET is_revoked = TRUE WHERE user_id = $(userId)`,
      { userId }
    );

    // Get all active refresh tokens for blacklisting
    const tokens = await db.manyOrNone(
      `SELECT token, expires_at FROM refresh_tokens WHERE user_id = $(userId) AND is_revoked = TRUE`,
      { userId }
    );

    // Blacklist all refresh tokens
    if (tokens && tokens.length > 0) {
      for (const token of tokens) {
        await db.none(
          `INSERT INTO blacklisted_tokens(token, user_id, expires_at) 
           VALUES($(token), $(userId), $(expiresAt))
           ON CONFLICT (token) DO NOTHING`,
          { token: token.token, userId, expiresAt: token.expires_at }
        );
      }
    }

    return {
      message: `All tokens revoked for user ${userId}`,
      tokensRevoked: tokens?.length || 0,
    };
  } catch (err: any) {
    console.error("Error revoking user tokens:", err.message);
    throw err;
  }
};


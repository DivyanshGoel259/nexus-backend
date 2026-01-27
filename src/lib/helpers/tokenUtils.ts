import jwt from "jsonwebtoken";
import db from "../db";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "your-refresh-secret-key";
const ACCESS_TOKEN_EXPIRY = "30m"; // 30 minutes
const REFRESH_TOKEN_EXPIRY = "7d"; // 7 days

export interface TokenPayload {
  userId: number;
  type: "access" | "refresh";
}

/**
 * Generate access and refresh tokens for a user
 */
export const generateTokens = (userId: number) => {
  const accessToken = jwt.sign(
    { userId, type: "access" } as TokenPayload,
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );

  const refreshToken = jwt.sign(
    { userId, type: "refresh" } as TokenPayload,
    JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );

  return { accessToken, refreshToken };
};

/**
 * Check if a token is blacklisted
 */
export const isTokenBlacklisted = async (token: string): Promise<boolean> => {
  const blacklisted = await db.oneOrNone(
    `SELECT id FROM blacklisted_tokens WHERE token = $(token) AND expires_at > NOW()`,
    { token }
  );
  return !!blacklisted;
};

/**
 * Verify and decode JWT token
 */
export const verifyToken = (token: string, type: "access" | "refresh"): TokenPayload => {
  const secret = type === "access" ? JWT_SECRET : JWT_REFRESH_SECRET;
  return jwt.verify(token, secret) as TokenPayload;
};

/**
 * Decode JWT token without verification (to get expiry, etc.)
 */
export const decodeToken = (token: string): any => {
  return jwt.decode(token);
};

export { JWT_SECRET, JWT_REFRESH_SECRET, ACCESS_TOKEN_EXPIRY, REFRESH_TOKEN_EXPIRY };


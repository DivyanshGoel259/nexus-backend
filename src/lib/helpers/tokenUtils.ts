import jwt from "jsonwebtoken";
import db from "../db";
import {
  isTokenBlacklisted as checkTokenBlacklist,
  blacklistToken as addTokenToBlacklist,
} from "../cache/tokenCache";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "your-refresh-secret-key";
const ACCESS_TOKEN_EXPIRY = "30m"; // 30 minutes
const REFRESH_TOKEN_EXPIRY = "7d"; // 7 days

export interface TokenPayload {
  userId: number;
  type: "access" | "refresh";
  iat?: number;
  exp?: number;
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
 * Check if a token is blacklisted (uses Redis cache for O(1) lookup)
 * Falls back to database if Redis is unavailable
 */
export const isTokenBlacklisted = async (token: string): Promise<boolean> => {
  return await checkTokenBlacklist(token);
};

/**
 * Blacklist a token (adds to Redis + Database for redundancy)
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
  await addTokenToBlacklist(token, userId, expiresAt);
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


/**
 * Rate Limiting Middleware using Redis
 * 
 * Protects against:
 * - Brute force attacks
 * - DDoS attacks
 * - API abuse
 * 
 * Uses Redis for distributed rate limiting (works across multiple servers)
 */

import { Request, Response, NextFunction } from "express";
import redis from "../lib/services/redis";

interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
  message?: string;      // Custom error message
  skipSuccessfulRequests?: boolean; // Only count failed requests
  keyGenerator?: (req: Request) => string; // Custom key generator
}

/**
 * Create rate limiter middleware
 */
export const createRateLimiter = (config: RateLimitConfig) => {
  const {
    windowMs,
    maxRequests,
    message = "Too many requests. Please try again later.",
    skipSuccessfulRequests = false,
    keyGenerator,
  } = config;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Generate unique key for this client
      const key = keyGenerator
        ? keyGenerator(req)
        : `rate_limit:${req.ip}:${req.path}`;

      // Get current count from Redis
      const current = await redis.get(key);
      const count = current ? parseInt(current) : 0;

      // Check if limit exceeded
      if (count >= maxRequests) {
        const ttl = await redis.ttl(key);
        const resetTime = ttl > 0 ? ttl : Math.ceil(windowMs / 1000);

        return res.status(429).json({
          error: {
            message,
            retryAfter: resetTime,
            limit: maxRequests,
            current: count,
          },
        });
      }

      // Increment counter
      if (skipSuccessfulRequests) {
        // Will increment only on error (see error handler below)
        (res as any).__rateLimitKey = key;
        (res as any).__rateLimitWindowMs = windowMs;
      } else {
        // Increment immediately
        const newCount = await redis.incr(key);
        
        // Set expiry on first request
        if (newCount === 1) {
          await redis.pexpire(key, windowMs);
        }
      }

      // Add rate limit headers
      const remaining = Math.max(0, maxRequests - count - 1);
      res.setHeader("X-RateLimit-Limit", maxRequests.toString());
      res.setHeader("X-RateLimit-Remaining", remaining.toString());
      res.setHeader("X-RateLimit-Reset", new Date(Date.now() + windowMs).toISOString());

      next();
    } catch (error: any) {
      // If Redis fails, log error but don't block request (fail open)
      console.error("⚠️ Rate limiter error:", error.message);
      next();
    }
  };
};

/**
 * Middleware to increment rate limit only on failed requests
 * Use after main request handler
 */
export const incrementOnError = async (err: any, req: Request, res: Response, next: NextFunction) => {
  const key = (res as any).__rateLimitKey;
  const windowMs = (res as any).__rateLimitWindowMs;

  if (key && windowMs) {
    try {
      const newCount = await redis.incr(key);
      if (newCount === 1) {
        await redis.pexpire(key, windowMs);
      }
    } catch (redisErr) {
      console.error("⚠️ Failed to increment rate limit:", redisErr);
    }
  }

  next(err);
};

/**
 * Pre-configured rate limiters for common use cases
 */

// Strict: Login attempts (5 per 15 minutes per IP)
export const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5,
  message: "Too many login attempts. Please try again after 15 minutes.",
  skipSuccessfulRequests: false,
  keyGenerator: (req) => `rate_limit:login:${req.ip}`,
});

// Strict: Login attempts by email (10 per hour)
export const loginByEmailRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 10,
  message: "Too many login attempts for this account. Please try again after 1 hour.",
  skipSuccessfulRequests: false,
  keyGenerator: (req) => `rate_limit:login:${req.body.email || req.body.phone}`,
});

// Medium: Registration (3 per hour per IP)
export const registerRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 3,
  message: "Too many registration attempts. Please try again after 1 hour.",
  keyGenerator: (req) => `rate_limit:register:${req.ip}`,
});

// Strict: OTP requests (5 per 30 minutes per phone)
export const otpRateLimiter = createRateLimiter({
  windowMs: 30 * 60 * 1000, // 30 minutes
  maxRequests: 5,
  message: "Too many OTP requests. Please try again after 30 minutes.",
  keyGenerator: (req) => `rate_limit:otp:${req.body.phone}`,
});

// Medium: Password reset (3 per hour per email)
export const passwordResetRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 3,
  message: "Too many password reset attempts. Please try again after 1 hour.",
  keyGenerator: (req) => `rate_limit:reset:${req.body.email || req.body.phone}`,
});

// Lenient: General API (100 per minute per IP)
export const apiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100,
  message: "Too many API requests. Please slow down.",
  keyGenerator: (req) => `rate_limit:api:${req.ip}`,
});

// Very Lenient: Authenticated users (1000 per minute)
export const authenticatedRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 1000,
  message: "Rate limit exceeded. Please slow down.",
  keyGenerator: (req) => {
    const userId = (req as any).userId || req.ip;
    return `rate_limit:auth:${userId}`;
  },
});

/**
 * Clear rate limit for a specific key (useful for testing or admin override)
 */
export const clearRateLimit = async (key: string): Promise<boolean> => {
  try {
    const deleted = await redis.del(key);
    return deleted > 0;
  } catch (error) {
    console.error("⚠️ Failed to clear rate limit:", error);
    return false;
  }
};

/**
 * Get current rate limit status
 */
export const getRateLimitStatus = async (key: string): Promise<{
  count: number;
  ttl: number;
  blocked: boolean;
} | null> => {
  try {
    const count = await redis.get(key);
    const ttl = await redis.ttl(key);

    if (!count) {
      return null;
    }

    return {
      count: parseInt(count),
      ttl,
      blocked: false, // You'd check against max limit here
    };
  } catch (error) {
    console.error("⚠️ Failed to get rate limit status:", error);
    return null;
  }
};

/**
 * Temporarily block an IP/user (security measure)
 */
export const blockTemporarily = async (
  identifier: string,
  durationSeconds: number = 3600,
  reason: string = "Security violation"
): Promise<void> => {
  try {
    const key = `rate_limit:blocked:${identifier}`;
    await redis.setex(key, durationSeconds, JSON.stringify({
      reason,
      blockedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + durationSeconds * 1000).toISOString(),
    }));
    console.log(`🚫 Temporarily blocked: ${identifier} for ${durationSeconds}s (${reason})`);
  } catch (error) {
    console.error("⚠️ Failed to block temporarily:", error);
  }
};

/**
 * Check if an IP/user is blocked
 */
export const isBlocked = async (identifier: string): Promise<boolean> => {
  try {
    const key = `rate_limit:blocked:${identifier}`;
    const blocked = await redis.get(key);
    return blocked !== null;
  } catch (error) {
    console.error("⚠️ Failed to check block status:", error);
    return false; // Fail open
  }
};

/**
 * Middleware to check if IP/user is blocked
 */
export const checkBlocked = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const identifier = (req as any).userId || req.ip;
    const blocked = await isBlocked(identifier);

    if (blocked) {
      const key = `rate_limit:blocked:${identifier}`;
      const blockData = await redis.get(key);
      const data = blockData ? JSON.parse(blockData) : {};

      return res.status(403).json({
        error: {
          message: "Access temporarily blocked due to security reasons.",
          reason: data.reason || "Security violation",
          expiresAt: data.expiresAt,
        },
      });
    }

    next();
  } catch (error) {
    console.error("⚠️ Block check error:", error);
    next(); // Fail open
  }
};


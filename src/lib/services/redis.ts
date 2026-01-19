import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

// Create Redis client
// Priority: REDIS_URL > Individual credentials
let redis: Redis;

if (process.env.REDIS_URL) {
  // Use connection URL (e.g., redis://username:password@host:port/db)
  redis = new Redis(process.env.REDIS_URL, {
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    maxRetriesPerRequest: 3,
  });
} else {
  // Fallback to individual credentials
  redis = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || "0"),
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  });
}

// Handle Redis connection events
redis.on("connect", () => {
  console.log("✅ Redis connected successfully");
});

redis.on("error", (err) => {
  console.error("❌ Redis connection error:", err.message);
});

redis.on("ready", () => {
  console.log("✅ Redis is ready to accept commands");
});

redis.on("close", () => {
  console.log("⚠️ Redis connection closed");
});

redis.on("reconnecting", () => {
  console.log("🔄 Reconnecting to Redis...");
});

export default redis;


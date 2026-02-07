# Production Readiness Analysis — Nexus Backend

**Date:** 2026-02-07  
**Codebase:** nexus-backend (Express + PostgreSQL + Redis + Socket.IO + Razorpay)  
**Verdict:** 🟡 **~65% Ready — DO NOT DEPLOY until critical issues fixed**

---

## Architecture Overview

```
Client (HTTP/WebSocket)
    │
    ├─ Express REST API (/api/v1/*)
    │   ├─ Auth     → JWT + Redis blacklist + Twilio OTP
    │   ├─ Events   → CRUD + Socket.IO broadcast
    │   ├─ Seats    → Redis SETNX lock + Postgres persistence
    │   ├─ Bookings → Transaction-safe booking flow
    │   └─ Payments → Razorpay orders + webhook confirmation
    │
    ├─ Socket.IO (real-time seat locking, events, bookings)
    │
    ├─ Redis (ioredis)
    │   ├─ Token blacklist (TTL auto-expiry)
    │   ├─ Refresh token cache
    │   ├─ Seat locks (SETNX atomic)
    │   └─ Rate limiting
    │
    └─ PostgreSQL (pg-promise)
        ├─ users, refresh_tokens, blacklisted_tokens
        ├─ events, event_seat_types, seats
        ├─ bookings, booking_seats
        └─ idempotency_keys
```

**What's Good:**
- Redis+Postgres hybrid for seat locking (SETNX atomic, DB fallback)
- Idempotency keys for booking cancellation (safe retries)
- Razorpay webhook with HMAC signature verification
- Socket.IO real-time broadcast for seat updates
- Token blacklist with Redis cache + DB persistence
- Virtual seats approach (on-demand creation, scales well)
- Comprehensive input validation (email, phone, password, OTP)
- Rate limiter middleware built and ready

---

## 🔴 CRITICAL Issues (Will crash or cause data loss)

### 1. Missing UNIQUE Constraint — `lockSeat()` Will CRASH

**File:** `src/seats/service.ts` (line 375)  
**Impact:** Runtime PostgreSQL error on every seat lock attempt

```typescript
// lockSeat() uses this:
ON CONFLICT (event_seat_type_id, seat_label) DO NOTHING
```

But the database only has `UNIQUE(event_id, seat_label)` (from `20260119160527_event.sql` line 99).  
There is **NO** `UNIQUE(event_seat_type_id, seat_label)` constraint.

The migration `20260207113319_seat_lock_optimizations.sql` that was supposed to add it **does not exist** in the migrations folder.

**Fix:** Create and run the migration:
```sql
ALTER TABLE seats ADD CONSTRAINT unique_event_seat_type_label 
  UNIQUE(event_seat_type_id, seat_label);
```

**OR** change the ON CONFLICT to match existing constraint:
```typescript
ON CONFLICT (event_id, seat_label) DO NOTHING
```

> ⚠️ Note: Using `(event_id, seat_label)` means two different seat types in the same event cannot share a label (e.g., VIP-A1 and Standard-A1 would conflict). Decide which constraint fits your domain.

---

### 2. Hardcoded JWT Secret Fallbacks

**File:** `src/lib/helpers/tokenUtils.ts` (lines 8-9)

```typescript
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "your-refresh-secret-key";
```

If `.env` is missing or misconfigured, all tokens are signed with a publicly known secret. Anyone can forge JWTs.

**Fix:** Crash on startup if secrets are missing:
```typescript
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("FATAL: JWT_SECRET not set");
```

---

### 3. Express Error Handler Broken (Missing `next` Parameter)

**File:** `src/index.ts` (lines 31-35)

```typescript
app.use((err: Error, req: express.Request, res: express.Response) => {
    return res.status(400).json({ error: { message: err.message || "something went wrong" } });
});
```

Express error handlers **must** have 4 parameters `(err, req, res, next)` to be recognized as error handlers. With 3 params, Express treats this as a regular middleware and errors won't be caught — they'll crash the process or return raw stack traces.

**Fix:**
```typescript
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Unhandled error:", err.message);
    return res.status(400).json({ error: { message: err.message || "something went wrong" } });
});
```

---

### 4. No Rate Limiting Applied to Any Route

**File:** `src/middlewares/rateLimiter.ts` — Middleware exists but is **never used**.

Rate limiters are defined (`loginRateLimiter`, `registerRateLimiter`, `otpRateLimiter`, `apiRateLimiter`) but:
- `src/index.ts` — no `app.use(apiRateLimiter)`
- `src/auth/router.ts` — no rate limiting on login/register/OTP routes

**Impact:** Brute force attacks on login, OTP flooding, DDoS on API.

**Fix:** Apply rate limiters in routers:
```typescript
// src/auth/router.ts
import { loginRateLimiter, registerRateLimiter, otpRateLimiter } from "../middlewares/rateLimiter";

router.post("/login", loginRateLimiter, login);
router.post("/register", registerRateLimiter, register);
router.post("/send-otp", otpRateLimiter, sendOtp);
```

```typescript
// src/index.ts
import { apiRateLimiter } from "./middlewares/rateLimiter";
app.use(apiRateLimiter);
```

---

### 5. No Cron Job for Expired Lock Cleanup

**File:** `src/index.ts` — No scheduled cleanup.

`cleanupExpiredLocks()` and `cleanupExpiredTokens()` exist but are never called. Expired locks accumulate forever in the database, and `available_quantity` is never restored for expired locks.

**Impact:** Seats get permanently "locked" after expiry. Users see "no seats available" even when seats should be free.

**Fix:** Add cron job in `src/index.ts`:
```typescript
import { cleanupExpiredLocks } from "./seats/service";
import { cleanupExpiredTokens } from "./lib/helpers/tokenCleanup";

// Run every 5 minutes
setInterval(async () => {
  try {
    await cleanupExpiredLocks();
  } catch (err) {
    console.error("Cleanup error:", err);
  }
}, 5 * 60 * 1000);

// Run every hour
setInterval(async () => {
  try {
    await cleanupExpiredTokens();
  } catch (err) {
    console.error("Token cleanup error:", err);
  }
}, 60 * 60 * 1000);
```

---

### 6. `.gitignore` Ignores `migrations/` Folder

**File:** `.gitignore` (line 4)

```
migrations
```

Your database migrations are NOT version controlled. If the repo is cloned, there are no migrations.

**Fix:** Remove `migrations` from `.gitignore`:
```
node_modules
.env
dist
```

---

## 🟠 HIGH Priority Issues

### 7. No Security Headers (Missing `helmet`)

**File:** `src/index.ts`

No `helmet` middleware. Missing headers: `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `X-XSS-Protection`, etc.

**Fix:**
```bash
npm install helmet
```
```typescript
import helmet from "helmet";
app.use(helmet());
```

---

### 8. CORS Wide Open (`origin: "*"`)

**Files:** `src/index.ts` (line 19), `src/lib/socket.ts` (line 18)

```typescript
app.use(cors());  // Allows ALL origins
// Socket.IO:
cors: { origin: "*" }
```

**Fix:** Restrict to your frontend domain:
```typescript
app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3000", credentials: true }));
```

---

### 9. No Request Body Size Limit

**File:** `src/index.ts` (line 17)

```typescript
app.use(express.json());  // No limit!
```

Attacker can send 100MB JSON body to crash/OOM the server.

**Fix:**
```typescript
app.use(express.json({ limit: "1mb" }));
```

---

### 10. Socket.IO Allows Unauthenticated Users Full Access

**File:** `src/lib/socket.ts` (lines 25-49)

Socket auth middleware allows unauthenticated connections (`userId = null`), but event handlers only check `if (!userId)` and emit an error — they don't disconnect. Unauthenticated users stay connected, consuming server resources.

Also, there's no rate limiting on socket events. A malicious client can flood `lock_seat` events.

**Fix:** Either disconnect unauthenticated users for protected events, or add per-socket rate limiting.

---

### 11. No Graceful Shutdown

**File:** `src/index.ts`

No handling for `SIGTERM`/`SIGINT`. On deployment (e.g., Docker, PM2), in-flight requests and DB transactions are abruptly killed.

**Fix:**
```typescript
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully...");
  httpServer.close(() => {
    redis.disconnect();
    process.exit(0);
  });
});
```

---

### 12. Twilio Client Created Without Credential Check

**File:** `src/lib/services/twilio.ts` (lines 6-9)

```typescript
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,  // Could be undefined!
  process.env.TWILIO_AUTH_TOKEN     // Could be undefined!
);
```

If env vars are missing, Twilio SDK may throw cryptic errors later at runtime.

**Fix:** Check on startup:
```typescript
if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
  console.warn("⚠️ Twilio credentials not set. OTP features will be unavailable.");
}
```

---

### 13. Database Connection Pool Not Configured

**File:** `src/lib/db.ts`

```typescript
const pgp = pgPromise();  // No pool config!
```

Default pg-promise pool size is 10 connections. Under load (50k+ concurrent users), this will bottleneck.

**Fix:**
```typescript
const pgp = pgPromise();
const db = pgp({
  connectionString: DATABASE_URL,
  ssl: NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 30,              // Max connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
```

---

### 14. SSL Check Uses Wrong Case

**File:** `src/lib/db.ts` (line 14)

```typescript
ssl: NODE_ENV === "Production" ? { rejectUnauthorized: false } : false,
```

`NODE_ENV` is typically `"production"` (lowercase). This will **never** enable SSL.

**Fix:**
```typescript
ssl: NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
```

---

### 15. `console.log` Everywhere — No Structured Logging

**Impact:** ~130+ console.log/error calls across the codebase. In production, these provide no log levels, no timestamps, no request correlation IDs.

**Fix:** Use `winston` or `pino`:
```bash
npm install pino pino-pretty
```

---

## 🟡 MEDIUM Priority Issues

### 16. Both `bcrypt` and `bcryptjs` in Dependencies

**File:** `package.json` (lines 19-20)

```json
"bcrypt": "^6.0.0",
"bcryptjs": "^3.0.3",
```

`bcrypt` is used in `auth/service.ts`, `bcryptjs` is used in `helpers/helpers.ts`. Pick one (recommend `bcrypt` for performance).

---

### 17. `@types` Packages in `dependencies` Instead of `devDependencies`

**File:** `package.json` (lines 15-17)

`@types/bcryptjs`, `@types/ioredis`, `@types/qrcode`, `@types/socket.io` are in `dependencies`. They should be in `devDependencies`.

---

### 18. Missing `typescript` in devDependencies

**File:** `package.json`

No `typescript` package. Build relies on globally installed TypeScript.

---

### 19. Test Files Should Not Be Deployed

**Files:** `src/test-redis-cache.ts`, `src/test-seat-lock-cache.ts`, `src/test-bug-fixes.ts`

These test scripts are in `src/` and would be compiled/deployed. Move to a `tests/` directory and exclude from build.

---

### 20. No Input Validation on Socket Events

**File:** `src/lib/socket.ts`

Socket event handlers accept data directly without validation:
```typescript
socket.on('lock_seat', async (data: { eventId: number; seatTypeId: number; seat_label: string }) => {
  // data is NOT validated - client could send anything
```

TypeScript types are compile-time only; runtime data can be anything.

**Fix:** Add runtime validation (e.g., `zod`, `joi`, or manual checks).

---

### 21. `(req as any).userId` — No Type Safety

**Files:** Multiple controllers

```typescript
const userId = (req as any).userId;
```

**Fix:** Create a typed request interface:
```typescript
interface AuthRequest extends Request {
  userId?: string;
}
```

---

### 22. No Health Check Endpoint

**File:** `src/index.ts`

Only has `GET /` returning "Backend is running". Need a proper `/health` endpoint checking DB + Redis connectivity.

---

### 23. No `.env.example` File

No `.env.example` for developers to know required environment variables.

Required env vars (gathered from codebase):
```
DATABASE_URL=
REDIS_URL=
JWT_SECRET=
JWT_REFRESH_SECRET=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SID=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
NODE_ENV=
PORT=
FRONTEND_URL=
```

---

### 24. `lockSeat` Socket Emit Doesn't Include `event:seats-update`

**File:** `src/lib/socket.ts` (line 288)

The socket broadcasts `seat_locked` event, but there's no `event:seats-update` event that tells all clients to refresh available seat counts for the event page. Frontend needs to know `available_quantity` changed.

Currently the `available_quantity` is only sent in the `seat_locked` payload to the requester, but other clients viewing the event page won't know seats became unavailable unless they manually refresh.

---

### 25. Webhook Returns 200 Even on Error

**File:** `src/payments/controller.ts` (lines 119-128)

```typescript
} catch (err: any) {
    return res.status(200).json({
      success: false,
      error: err.message,
    });
}
```

Returning 200 on webhook failure tells Razorpay "all good, don't retry". If booking confirmation fails, the payment is lost.

**Fix:** Return 500 so Razorpay retries:
```typescript
return res.status(500).json({ success: false, error: err.message });
```

---

## Summary Scorecard

| Category | Score | Details |
|----------|-------|---------|
| **Security** | 🔴 40% | Hardcoded JWT fallback, no helmet, CORS *, no rate limiting applied, socket auth weak |
| **Data Integrity** | 🔴 50% | Missing UNIQUE constraint crashes lockSeat, no cleanup cron, error handler broken |
| **Performance** | 🟡 70% | Redis caching good, but DB pool unconfigured, no body size limit |
| **Code Quality** | 🟡 65% | Good structure, but no logger, mixed bcrypt libs, @types in wrong place |
| **DevOps** | 🔴 40% | No graceful shutdown, no health check, .gitignore hides migrations, no .env.example |
| **Real-time** | 🟡 70% | Socket.IO works, but no socket rate limiting, no input validation |
| **Payments** | 🟡 75% | Razorpay webhook secure (HMAC), but returns 200 on error |

**Overall: 🟡 ~65% — Needs 6 critical fixes before production**

---

## Priority Fix Order

```
PRIORITY 1 (Do immediately — system broken without these):
  ├─ #1  Create UNIQUE constraint migration (lockSeat crashes without it)
  ├─ #3  Fix Express error handler (4 params)
  ├─ #6  Remove 'migrations' from .gitignore
  └─ #2  Remove hardcoded JWT secret fallbacks

PRIORITY 2 (Security — do before any public access):
  ├─ #4  Apply rate limiters to auth routes
  ├─ #7  Add helmet middleware
  ├─ #8  Restrict CORS origins
  └─ #9  Add body size limit

PRIORITY 3 (Reliability — do before production traffic):
  ├─ #5  Add cron job for cleanup
  ├─ #11 Add graceful shutdown
  ├─ #14 Fix SSL case sensitivity
  ├─ #13 Configure DB connection pool
  └─ #25 Fix webhook error response code

PRIORITY 4 (Quality — do during next sprint):
  ├─ #15 Add structured logging
  ├─ #10 Socket auth + rate limiting
  ├─ #22 Health check endpoint
  ├─ #23 Create .env.example
  └─ Everything else
```


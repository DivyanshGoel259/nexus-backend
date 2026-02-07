# 🧪 Complete Testing Guide - Redis Cache & Rate Limiting

## 📋 Overview

This guide tests all implemented features:
- ✅ Redis JWT Blacklist Cache
- ✅ Redis Seat Lock Cache (NEW! ⚡)
- ✅ Rate Limiting (Login, Register, OTP, Password Reset)
- ✅ Input Validation (Email, Phone, Password, Username)
- ✅ Security Features (OTP Password Reset, Token Revocation)
- ✅ Email/Phone Normalization
- ✅ Bug Fixes (logout is_revoked, email consistency)

---

## 🚀 Prerequisites

### **1. Start Services**

```bash
# Start Redis
redis-server

# Verify Redis is running
redis-cli ping
# Expected: PONG
```

```bash
# Start your application
npm run dev
# or
npm start
```

### **2. Environment Check**

Verify `.env` file has:
```env
# Database
DATABASE_URL=postgresql://...

# Redis
REDIS_URL=redis://localhost:6379

# JWT Secrets (must be different!)
JWT_SECRET=your-strong-secret-minimum-32-chars
JWT_REFRESH_SECRET=your-different-secret-minimum-32-chars

# Twilio (for OTP)
TWILIO_ACCOUNT_SID=your_sid
TWILIO_AUTH_TOKEN=your_token
TWILIO_VERIFY_SID=your_verify_sid
```

### **3. Testing Tools**

Install tools:
```bash
# Option 1: curl (already installed on most systems)
curl --version

# Option 2: httpie (optional, prettier output)
pip install httpie

# Option 3: Postman/Insomnia (GUI)
```

---

## 🧪 Test Suite

---

## **Test 1: Redis Cache - Token Blacklist** ⭐⭐⭐

### **Objective:** Verify Redis cache is working for JWT blacklist

### **Automated Test:**
```bash
# Run the test script
npx ts-node src/test-redis-cache.ts
```

**Expected Output:**
```
🧪 Starting Redis Token Cache Tests...

📝 Test 1: Generate Test Tokens
✅ Access Token Generated: ...
✅ Refresh Token Generated: ...

📝 Test 2: Check Token NOT Blacklisted
✅ Token blacklisted: false (Expected: false)

📝 Test 3: Blacklist Token
✅ Token blacklisted in Redis (TTL: 1800s)
✅ Token blacklisted in Database

📝 Test 4: Check Token IS Blacklisted
✅ Token blacklisted: true (Expected: true)

📝 Test 5: Cache Refresh Token
✅ Refresh token cached (TTL: 604800s)

📝 Test 6: Performance Test (10 lookups)
✅ Redis: 10 lookups in 23ms (avg: 2.30ms)

📝 Test 7: Cache Statistics
✅ Cache Stats:
  - Blacklisted Tokens: 1
  - Refresh Tokens: 1

📝 Test 8: Verify Redis Key
✅ Redis key exists: true (Expected: true)

📝 Test 9: Check Token TTL
✅ Token TTL: 1798 seconds (should be ~1800 for 30 min)

🧹 Cleanup: Removing test tokens from Redis
✅ Cleanup completed

============================================================
✅ ALL TESTS PASSED! 🎉
============================================================

📊 Performance Summary:
   - Average lookup time: 2.30ms
   - Expected improvement: 10-50x faster than database
   - Cache hit rate: 100% (after first lookup)

✅ Redis Token Cache is working correctly!
```

**If test fails:**
```bash
# Check Redis connection
redis-cli ping

# Check Redis keys manually
redis-cli
KEYS blacklist:*
KEYS refresh_token:*
```

---

## **Test 1.5: Redis Cache - Seat Lock Cache** ⭐⭐⭐ 🆕

### **Objective:** Verify Redis seat lock cache prevents double-bookings

### **Automated Test:**
```bash
# Run the seat lock test script
npx ts-node src/test-seat-lock-cache.ts
```

**Expected Output:**
```
🚀 Redis Seat Lock Cache Test Suite
============================================================

🧪 Starting Redis Seat Lock Cache Tests...

📝 Test 1: Acquire Seat Lock (Atomic SETNX)
✅ Lock acquired: V1 by User 11111

📝 Test 2: Prevent Double-Booking
✅ Double-booking prevented: V1 already locked by User 11111

📝 Test 3: Check Seat Lock Status
✅ Seat V1 is locked by User 11111

📝 Test 4: Acquire Multiple Seats
✅ Multiple seats locked:
   V2 → User 11111
   V3 → User 22222
   P1 → User 11111

📝 Test 5: Batch Check Seats (MGET)
✅ Batch check results (5 seats):
   V1: LOCKED by User 11111
   V2: LOCKED by User 11111
   V3: LOCKED by User 22222
   P1: LOCKED by User 11111
   P2: AVAILABLE

📝 Test 9: Performance Test (100 lock attempts)
✅ Redis: 100 checks in 150ms (avg: 1.50ms)
📊 Expected DB time: ~4500ms (30x slower)
⚡ Performance improvement: ~97% faster than DB transactions

📝 Test 13: Concurrent Lock Attempts (Race Condition)
✅ Race condition handled: Only 1 user acquired lock
✅ 4 other users were correctly rejected

============================================================
✅ ALL TESTS PASSED! 🎉
============================================================

📊 Performance Summary:
   - Average lock check: 1.50ms
   - Expected DB time: ~50-150ms per check
   - Performance gain: ~97% faster (30-50x)
   - Double-booking prevention: ✅ Atomic SETNX
   - Race condition handling: ✅ Passed

✅ Redis Seat Lock Cache is working correctly!
```

**Key Features Tested:**
- ✅ Atomic seat lock acquisition (SETNX)
- ✅ Double-booking prevention
- ✅ Race condition handling (concurrent requests)
- ✅ Unauthorized lock release prevention
- ✅ Batch seat checking (MGET)
- ✅ Performance (97% faster than DB)

**If test fails:**
```bash
# Check Redis connection
redis-cli ping

# Check seat lock keys manually
redis-cli
KEYS seat_lock:*

# Check a specific seat lock
GET seat_lock:99999:88888:V1

# Check TTL
TTL seat_lock:99999:88888:V1
```

**Manual API Test:**
```bash
# Lock a seat
curl -X POST http://localhost:3000/api/seats/lock \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": 1,
    "seatTypeId": 1,
    "seatLabel": "V1"
  }'

# Expected: Success with cache_hit: true

# Try to lock same seat with different user (should fail)
curl -X POST http://localhost:3000/api/seats/lock \
  -H "Authorization: Bearer DIFFERENT_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": 1,
    "seatTypeId": 1,
    "seatLabel": "V1"
  }'

# Expected: Error "Seat V1 is already taken"
```

---

## **Test 2: User Registration with Validation** ⭐⭐⭐

### **Test 2.1: Valid Registration**

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser123",
    "name": "Test User",
    "email": "Test@Example.Com",
    "phone": "9876543210",
    "password": "Strong@123",
    "address": "123 Test St",
    "city": "Mumbai"
  }'
```

**Expected Response (200):**
```json
{
  "user": {
    "id": 1,
    "username": "testuser123",
    "name": "Test User",
    "email": "test@example.com",  // ✅ Lowercased!
    "phone": "+919876543210",     // ✅ Normalized!
    "created_at": "2026-02-06T..."
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
  "message": "User registered successfully"
}
```

**Verify Redis Cache:**
```bash
redis-cli
GET refresh_token:eyJhbGciOiJIUzI1NiIsInR5cCI6...
# Should return cached token data
```

---

### **Test 2.2: Invalid Email**

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "invalid.email",
    "password": "Strong@123"
  }'
```

**Expected Response (400):**
```json
{
  "error": {
    "message": "Validation failed: Invalid email format"
  }
}
```

---

### **Test 2.3: Weak Password**

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@test.com",
    "password": "weak"
  }'
```

**Expected Response (400):**
```json
{
  "error": {
    "message": "Validation failed: Password must be at least 8 characters long"
  }
}
```

---

### **Test 2.4: Invalid Phone**

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@test.com",
    "phone": "123",
    "password": "Strong@123"
  }'
```

**Expected Response (400):**
```json
{
  "error": {
    "message": "Validation failed: Invalid phone number format"
  }
}
```

---

## **Test 3: Login & Email Case-Insensitivity** ⭐⭐⭐

### **Test 3.1: Login with Different Case**

**Register with:** `Test@Example.Com`  
**Login with:** `test@example.com` (lowercase)

```bash
# Should work! (Email normalization)
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Strong@123"
  }'
```

**Expected Response (200):**
```json
{
  "user": {
    "id": 1,
    "username": "testuser123",
    "name": "Test User",
    "email": "test@example.com",
    "phone": "+919876543210"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
  "message": "Login successful"
}
```

---

### **Test 3.2: Login with Uppercase**

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "TEST@EXAMPLE.COM",
    "password": "Strong@123"
  }'
```

**Expected Response (200):**
✅ Should work! Email is normalized to lowercase

---

## **Test 4: Rate Limiting - Login** ⭐⭐⭐

### **Test 4.1: Exceed Login Rate Limit**

```bash
# Try 6 login attempts rapidly (limit is 5 per 15 minutes)
for i in {1..6}; do
  echo "Attempt $i:"
  curl -X POST http://localhost:3000/auth/login \
    -H "Content-Type: application/json" \
    -d '{
      "email": "test@test.com",
      "password": "wrongpassword"
    }' \
    -w "\nHTTP Code: %{http_code}\n\n"
  sleep 1
done
```

**Expected Output:**
```
Attempt 1:
HTTP Code: 401
{"error": {"message": "Invalid email or password"}}

Attempt 2:
HTTP Code: 401
{"error": {"message": "Invalid email or password"}}

Attempt 3:
HTTP Code: 401
{"error": {"message": "Invalid email or password"}}

Attempt 4:
HTTP Code: 401
{"error": {"message": "Invalid email or password"}}

Attempt 5:
HTTP Code: 401
{"error": {"message": "Invalid email or password"}}

Attempt 6:
HTTP Code: 429  ✅ RATE LIMITED!
{
  "error": {
    "message": "Too many login attempts. Please try again after 15 minutes.",
    "retryAfter": 900,
    "limit": 5,
    "current": 5
  }
}
```

**Verify Redis:**
```bash
redis-cli
KEYS rate_limit:login:*
GET rate_limit:login:127.0.0.1
TTL rate_limit:login:127.0.0.1
# Should show remaining seconds (~900)
```

---

### **Test 4.2: Clear Rate Limit**

```bash
# In your application or Redis CLI
redis-cli
DEL rate_limit:login:127.0.0.1
DEL rate_limit:login:test@test.com
```

Now try login again - should work!

---

## **Test 5: Rate Limiting - Registration** ⭐⭐⭐

```bash
# Try 4 registration attempts (limit is 3 per hour)
for i in {1..4}; do
  echo "Registration Attempt $i:"
  curl -X POST http://localhost:3000/auth/register \
    -H "Content-Type: application/json" \
    -d "{
      \"username\": \"user$i\",
      \"email\": \"user$i@test.com\",
      \"password\": \"Strong@123\"
    }" \
    -w "\nHTTP Code: %{http_code}\n\n"
  sleep 1
done
```

**Expected:**
- Attempts 1-3: Success (200)
- Attempt 4: Rate limited (429)

---

## **Test 6: OTP Send & Rate Limiting** ⭐⭐⭐

### **Test 6.1: Send OTP with Phone Normalization**

```bash
# Test 1: Indian format (10 digits)
curl -X POST http://localhost:3000/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "9876543210"}'

# Should normalize to: +919876543210
```

```bash
# Test 2: With country code (91)
curl -X POST http://localhost:3000/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543210"}'

# Should normalize to: +919876543210
```

```bash
# Test 3: Already normalized
curl -X POST http://localhost:3000/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "+919876543210"}'

# Should stay: +919876543210
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "OTP sent successfully",
  "status": "pending",
  "expiresIn": "10 minutes"
}
```

---

### **Test 6.2: OTP Rate Limiting**

```bash
# Try 6 OTP requests (limit is 5 per 30 minutes)
for i in {1..6}; do
  echo "OTP Attempt $i:"
  curl -X POST http://localhost:3000/auth/send-otp \
    -H "Content-Type: application/json" \
    -d '{"phone": "+919876543210"}' \
    -w "\nHTTP Code: %{http_code}\n\n"
  sleep 2
done
```

**Expected:**
- Attempts 1-5: Success (200)
- Attempt 6: Rate limited (429)

---

## **Test 7: OTP Verification & Login** ⭐⭐⭐

### **Test 7.1: Verify OTP**

```bash
# Use the OTP received via SMS/Twilio
curl -X POST http://localhost:3000/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+919876543210",
    "otp": "123456"
  }'
```

**Expected Response (200):**
```json
{
  "user": {
    "id": 2,
    "username": null,
    "name": null,
    "email": null,
    "phone": "+919876543210"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
  "message": "OTP verified, user created and login successful",
  "isNewUser": true
}
```

**Verify Redis Cache:**
```bash
redis-cli
GET refresh_token:eyJhbGciOiJIUzI1NiIsInR5cCI6...
# Should return cached refresh token data
```

---

### **Test 7.2: Invalid OTP Format**

```bash
curl -X POST http://localhost:3000/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+919876543210",
    "otp": "12"
  }'
```

**Expected Response (400):**
```json
{
  "error": {
    "message": "Invalid OTP format. OTP must be 4-6 digits."
  }
}
```

---

## **Test 8: Logout & Token Blacklisting** ⭐⭐⭐

### **Test 8.1: Logout (Blacklist Tokens)**

```bash
# Save your tokens from login/register
ACCESS_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
REFRESH_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6..."

# Logout
curl -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}"
```

**Expected Response (200):**
```json
{
  "message": "Logout successful"
}
```

**Verify Redis Cache:**
```bash
redis-cli

# Check blacklisted access token
GET blacklist:eyJhbGciOiJIUzI1NiIsInR5cCI6...
# Should return: {"userId":1,"expiresAt":"...","blacklistedAt":"..."}

# Check TTL
TTL blacklist:eyJhbGciOiJIUzI1NiIsInR5cCI6...
# Should return: ~1800 seconds (30 minutes)
```

---

### **Test 8.2: Use Blacklisted Token (Should Fail)**

```bash
# Try to use the blacklisted access token
curl -X GET http://localhost:3000/protected-route \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

**Expected Response (401):**
```json
{
  "error": {
    "message": "Token has been revoked"
  }
}
```

**Check Application Logs:**
```
✅ Token blacklist check: HIT (Redis)
```

This proves Redis cache is working! ⚡

---

## **Test 9: Password Reset with OTP** ⭐⭐⭐

### **Test 9.1: Request OTP for Password Reset**

```bash
curl -X POST http://localhost:3000/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "+919876543210"}'
```

---

### **Test 9.2: Reset Password with OTP**

```bash
# Use the OTP received
curl -X POST http://localhost:3000/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+919876543210",
    "otp": "123456",
    "newPassword": "NewStrong@456"
  }'
```

**Expected Response (200):**
```json
{
  "message": "Password reset successful. Please login with your new password.",
  "security_note": "All existing sessions have been terminated for security."
}
```

**Verify Token Revocation:**
```bash
# Try using old access token
curl -X GET http://localhost:3000/protected-route \
  -H "Authorization: Bearer $OLD_ACCESS_TOKEN"

# Expected: 401 - "Token has been revoked"
```

---

### **Test 9.3: Login with New Password**

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "NewStrong@456"
  }'
```

**Expected Response (200):**
✅ Login successful with new password!

---

## **Test 10: Token Refresh** ⭐⭐

### **Test 10.1: Refresh Access Token**

```bash
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}"
```

**Expected Response (200):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
  "message": "Access token refreshed successfully"
}
```

---

### **Test 10.2: Use Revoked Refresh Token**

```bash
# After logout or password reset
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\": \"$REVOKED_REFRESH_TOKEN\"}"
```

**Expected Response (401):**
```json
{
  "error": {
    "message": "Refresh token has been revoked"
  }
}
```

---

## **Test 11: Performance Test - Cache vs Database** ⭐⭐⭐

### **Test 11.1: Measure Token Validation Speed**

```bash
# Create a simple benchmark script
cat > benchmark.sh << 'EOF'
#!/bin/bash

TOKEN="your_access_token_here"

echo "Benchmarking token validation (10 requests)..."
START=$(date +%s%N)

for i in {1..10}; do
  curl -s -X GET http://localhost:3000/protected-route \
    -H "Authorization: Bearer $TOKEN" > /dev/null
done

END=$(date +%s%N)
DIFF=$(( (END - START) / 1000000 ))
AVG=$(( DIFF / 10 ))

echo "Total time: ${DIFF}ms"
echo "Average per request: ${AVG}ms"
echo "Expected: 1-5ms with Redis cache"
EOF

chmod +x benchmark.sh
./benchmark.sh
```

**Expected Output:**
```
Benchmarking token validation (10 requests)...
Total time: 35ms
Average per request: 3.5ms
Expected: 1-5ms with Redis cache ✅
```

---

### **Test 11.2: Check Redis Performance**

```bash
redis-cli --intrinsic-latency 100
```

**Expected:**
```
Max latency so far: 1 milliseconds.
Average latency: 0.23 milliseconds.
```

---

## **Test 12: Check Database Consistency** ⭐

### **Test 12.1: Verify Email Normalization in DB**

```sql
-- Connect to PostgreSQL
psql -U postgres -d your_database

-- Check users table
SELECT id, username, email, phone FROM users LIMIT 10;

-- Verify emails are lowercase
-- Expected: All emails should be lowercase
```

**Expected:**
```
 id | username    | email              | phone
----|-------------|--------------------|--------------
  1 | testuser123 | test@example.com   | +919876543210
  2 | NULL        | NULL               | +919876543211
```

---

### **Test 12.2: Check Refresh Tokens**

```sql
-- Check refresh_tokens table
SELECT id, user_id, is_revoked, expires_at 
FROM refresh_tokens 
ORDER BY created_at DESC 
LIMIT 5;
```

**Expected:**
```
 id | user_id | is_revoked | expires_at
----|---------|------------|--------------------
  5 | 1       | true       | 2026-02-13 10:00:00
  4 | 1       | true       | 2026-02-13 10:00:00
  3 | 1       | false      | 2026-02-13 10:00:00
```

---

### **Test 12.3: Check Blacklisted Tokens**

```sql
SELECT id, user_id, expires_at 
FROM blacklisted_tokens 
ORDER BY created_at DESC 
LIMIT 5;
```

---

## **Test 13: Redis Cache Statistics** ⭐

### **Check Redis Usage**

```bash
redis-cli

# Get all keys
KEYS *

# Count keys by pattern
KEYS blacklist:* | wc -l
KEYS refresh_token:* | wc -l
KEYS rate_limit:* | wc -l

# Check memory usage
INFO memory

# Check key expiry
TTL blacklist:some_token
TTL refresh_token:some_token
TTL rate_limit:login:192.168.1.1

# Monitor real-time
MONITOR
# Then make API requests and watch Redis commands
```

**Expected Output:**
```
KEYS blacklist:* → 5 keys
KEYS refresh_token:* → 3 keys
KEYS rate_limit:* → 2 keys

Memory Usage: ~2MB
```

---

## **Test 14: Error Handling & Edge Cases** ⭐

### **Test 14.1: Double Logout (Idempotency)**

```bash
# Logout twice with same token
curl -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}"

# Second logout (same token)
curl -X POST http://localhost:3000/auth/logout \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"refreshToken\": \"$REFRESH_TOKEN\"}"
```

**Expected:**
- First: 200 - "Logout successful"
- Second: 200 - Still works (idempotent)

**Check Logs:**
```
⚠️ Refresh token was already revoked or not found
```

---

### **Test 14.2: Redis Down (Fallback to Database)**

```bash
# Stop Redis
redis-cli shutdown

# Try login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Strong@123"
  }'
```

**Expected Response (200):**
✅ Still works! Falls back to database

**Check Logs:**
```
⚠️ Redis check failed, falling back to DB
✅ Token blacklist check: MISS (Database) - Token is valid
```

---

## 📊 Final Verification Checklist

### **✅ Redis Cache**
- [ ] Automated test passes (`npx ts-node src/test-redis-cache.ts`)
- [ ] Token validation < 5ms average
- [ ] Redis keys exist (`KEYS blacklist:*`)
- [ ] TTL auto-expires tokens
- [ ] Database fallback works

### **✅ Rate Limiting**
- [ ] Login rate limit works (5 per 15 min)
- [ ] Register rate limit works (3 per hour)
- [ ] OTP rate limit works (5 per 30 min)
- [ ] Rate limit keys exist in Redis
- [ ] 429 response on exceeded limit

### **✅ Input Validation**
- [ ] Email validation works
- [ ] Phone validation works
- [ ] Password strength validation works
- [ ] XSS sanitization works
- [ ] Generic error messages (no user enumeration)

### **✅ Security Features**
- [ ] OTP password reset works
- [ ] All tokens revoked on password reset
- [ ] Email case-insensitive (Test@Example.Com = test@example.com)
- [ ] Phone normalization works (9876543210 = +919876543210)
- [ ] Logout blacklists tokens
- [ ] Blacklisted tokens rejected

### **✅ Bug Fixes**
- [ ] logout() is_revoked check works (no duplicate updates)
- [ ] Email consistency (lowercase in DB and queries)
- [ ] Phone normalization consistent
- [ ] Refresh token inserts have correct parameters

---

## 🐛 Troubleshooting

### **Issue: Redis tests fail**

```bash
# Check Redis
redis-cli ping
# If fails: redis-server

# Check connection
redis-cli
INFO server
```

---

### **Issue: Rate limiting not working**

```bash
# Check Redis keys
redis-cli
KEYS rate_limit:*

# If no keys, rate limiter may not be applied
# Solution: Check router configuration
```

---

### **Issue: Email login fails after registration**

```bash
# Check database
psql -U postgres -d your_db
SELECT email FROM users WHERE email LIKE '%Example%';

# If found mixed case, migration needed
UPDATE users SET email = LOWER(email);
```

---

### **Issue: OTP not received**

```bash
# Check Twilio credentials
echo $TWILIO_ACCOUNT_SID
echo $TWILIO_VERIFY_SID

# Check Twilio logs
# Visit: https://console.twilio.com
```

---

## 🎯 Expected Final Results

### **Performance Metrics:**
```
Token Validation:     1-5ms (Redis cache)
Database Queries:     90% reduction
Rate Limit Check:     2-3ms (Redis)
Server Response:      < 100ms for most endpoints
```

### **Security Metrics:**
```
Input Validation:     100% coverage
Rate Limiting:        All auth endpoints protected
Token Revocation:     Instant (Redis cache)
Password Reset:       OTP-verified
Email/Phone:          Normalized & consistent
```

### **Reliability Metrics:**
```
Redis Availability:   99.9% (with DB fallback)
Idempotency:          All operations safe to retry
Error Handling:       Graceful degradation
Cache Hit Rate:       > 95% for token validation
```

---

## 🎉 Success Criteria

All tests passing = **PRODUCTION READY!** 🚀

✅ Redis cache working (< 5ms token validation)  
✅ Rate limiting working (429 on exceeded limits)  
✅ Input validation working (400 on invalid inputs)  
✅ Security features working (OTP, token revocation)  
✅ Bug fixes verified (email consistency, logout)  
✅ Database fallback working (if Redis fails)  
✅ No linter errors  
✅ No runtime errors  

---

## 📚 Additional Resources

- **Redis Commands:** https://redis.io/commands
- **Twilio Verify:** https://www.twilio.com/docs/verify
- **JWT Best Practices:** https://tools.ietf.org/html/rfc8725
- **OWASP Top 10:** https://owasp.org/www-project-top-ten/

---

**Happy Testing! 🧪✨**

*Last Updated: February 6, 2026*


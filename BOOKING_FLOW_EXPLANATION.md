# 📋 Booking Flow Explanation

## Current System State

### ✅ Already Implemented:
1. **Seat Locking** - User can lock seats for 10 minutes
   - Route: `POST /api/v1/seats/:eventId/seat-types/:seatTypeId/lock`
   - Creates seat with `status='locked'` in `seats` table
   - Decrements `available_quantity` in `event_seat_types`
   - Lock expires after 10 minutes

### ❌ Not Yet Implemented:
1. **Booking Creation** - Create booking record
2. **Payment Processing** - Handle payment gateway integration
3. **Seat Conversion** - Convert locked seats to booked seats
4. **Ticket Generation** - Generate tickets with QR codes

---

## 🎯 Complete Booking Flow

### **Step 1: User Locks Seats** ✅ (Already Done)
```
User selects seats → Locks them via API
- Seats table: status='locked', expires_at=10 minutes
- available_quantity decremented
- User has 10 minutes to complete booking
```

**Example:**
- User locks: V1, V2, V3 (3 VIP seats)
- Each seat locked for 10 minutes
- available_quantity reduced by 3

---

### **Step 2: User Initiates Booking** (Need to Implement)
```
POST /api/v1/bookings/create
Body: {
  event_id: 1,
  seat_details: [
    { seat_label: "V1", seat_type_id: 1 },
    { seat_label: "V2", seat_type_id: 1 },
    { seat_label: "V3", seat_type_id: 1 }
  ]
}
```

**What Happens:**
1. ✅ Verify all seats are locked by this user (not expired)
2. ✅ Calculate total amount from seat prices
3. ✅ Create booking record:
   - `status = 'pending'` (booking created, payment pending)
   - `payment_status = 'pending'` (payment not done yet)
   - `booking_reference = 'BKG-2026-0120-143025-A1B2'` (unique)
4. ✅ Link locked seats to booking (but don't convert yet)
5. ✅ Return booking details with payment link/instructions

**Database State:**
- `bookings` table: New row with status='pending', payment_status='pending'
- `seats` table: Seats still have status='locked' (NOT booked yet)
- `booking_seats` table: Links booking to locked seats (but seats not booked)

---

### **Step 3: User Makes Payment** (Need to Implement)
```
Payment Gateway Integration (Razorpay/Stripe/PayPal)
- User redirected to payment page
- User completes payment
- Payment gateway sends webhook/callback
```

**Payment Gateway Options:**
- **Razorpay** (India) - Most popular in India
- **Stripe** (International) - Global payment gateway
- **PayPal** (International) - Alternative option

**Webhook Flow:**
```
Payment Gateway → Webhook → Your Backend
POST /api/v1/bookings/payment/webhook
Body: {
  booking_reference: "BKG-2026-0120-143025-A1B2",
  payment_id: "pay_xyz123",
  payment_status: "success", // or "failed"
  amount: 300.00
}
```

---

### **Step 4: Payment Confirmation & Seat Booking** (Need to Implement)
```
When payment webhook received:
1. ✅ Verify payment signature (security)
2. ✅ Update booking:
   - status = 'confirmed'
   - payment_status = 'completed'
   - confirmed_at = CURRENT_TIMESTAMP
3. ✅ Convert locked seats to booked seats:
   - UPDATE seats SET status='booked', booked_at=CURRENT_TIMESTAMP
   - WHERE status='locked' AND booking_id matches
4. ✅ Generate tickets with QR codes
5. ✅ Send confirmation email/SMS
6. ✅ Broadcast booking confirmation (WebSocket)
```

**Database State After Payment:**
- `bookings` table: status='confirmed', payment_status='completed'
- `seats` table: status='locked' → 'booked', booked_at set
- `booking_seats` table: Already linked (no change)
- Tickets generated with QR codes

---

### **Step 5: Ticket Generation** (Need to Implement)
```
For each booked seat:
1. Generate unique ticket_id: "TKT-{booking_ref}-{seat_label}"
2. Generate QR code (data URL)
3. Store ticket info (optional: separate tickets table)
4. Return tickets in response
```

---

## 📊 Database Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: SEAT LOCKING (✅ Already Done)                     │
├─────────────────────────────────────────────────────────────┤
│ seats table:                                                │
│   id | event_id | seat_label | user_id | status | expires_at│
│   1  |    1     |    V1      |    5    | locked | 10 min   │
│   2  |    1     |    V2      |    5    | locked | 10 min   │
│   3  |    1     |    V3      |    5    | locked | 10 min   │
│                                                             │
│ event_seat_types:                                           │
│   available_quantity: 47 (was 50, now 47 after 3 locks)    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: BOOKING CREATION (❌ Need to Implement)            │
├─────────────────────────────────────────────────────────────┤
│ bookings table:                                             │
│   id | booking_ref | event_id | user_id | total | status   │
│   1  | BKG-2026... |    1     |    5    | 300.00| pending │
│                                                             │
│ booking_seats table:                                        │
│   booking_id | seat_id | price_paid                        │
│      1       |    1    |  100.00                           │
│      1       |    2    |  100.00                           │
│      1       |    3    |  100.00                           │
│                                                             │
│ seats table: (NO CHANGE YET - still locked)                │
│   status = 'locked' (NOT booked yet!)                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: PAYMENT (❌ Need to Implement)                     │
├─────────────────────────────────────────────────────────────┤
│ User pays via Razorpay/Stripe                               │
│ Payment Gateway → Webhook → Backend                         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: PAYMENT CONFIRMATION (❌ Need to Implement)       │
├─────────────────────────────────────────────────────────────┤
│ bookings table:                                             │
│   status = 'confirmed'                                      │
│   payment_status = 'completed'                              │
│   confirmed_at = CURRENT_TIMESTAMP                          │
│                                                             │
│ seats table: (NOW CONVERTED TO BOOKED)                     │
│   id | status | booked_at                                  │
│   1  | booked | 2026-01-20 14:35:00                        │
│   2  | booked | 2026-01-20 14:35:00                        │
│   3  | booked | 2026-01-20 14:35:00                         │
│                                                             │
│ Tickets generated with QR codes                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔄 Two-Phase Booking System

### **Why Two Phases?**

1. **Lock Phase** (Step 1):
   - Prevents double booking
   - Reserves seats temporarily
   - Gives user time to complete payment

2. **Booking Phase** (Step 2-4):
   - Creates booking record
   - Processes payment
   - Confirms booking
   - Converts locks to bookings

### **Benefits:**
- ✅ Prevents race conditions
- ✅ Gives users time to pay
- ✅ Tracks payment status separately
- ✅ Can cancel if payment fails
- ✅ Industry standard approach

---

## 🚨 Edge Cases to Handle

### **1. Lock Expires Before Payment**
- User locks seats → Takes too long → Lock expires
- **Solution:** Check lock expiry before creating booking
- If expired, return error: "Seats expired, please lock again"

### **2. Payment Fails**
- Booking created → Payment fails
- **Solution:** 
  - Keep booking with `payment_status='failed'`
  - Release locks after timeout (or manual cleanup)
  - Restore `available_quantity`

### **3. Payment Succeeds But Seat Already Booked**
- Race condition: Two users try to book same seat
- **Solution:** 
  - Use database transaction
  - Check seat status before converting
  - Rollback if conflict detected

### **4. Partial Payment (Multiple Seats)**
- User books 3 seats, payment for 2 succeeds
- **Solution:** 
  - All-or-nothing approach (recommended)
  - Or: Book only paid seats, refund others

---

## 📝 Implementation Plan

### **Phase 1: Booking Creation** (Step 2)
- `POST /api/v1/bookings/create`
- Verify locked seats
- Create booking record
- Link seats to booking
- Return booking details

### **Phase 2: Payment Integration** (Step 3)
- Choose payment gateway (Razorpay recommended for India)
- Create payment order
- Generate payment link
- Handle payment webhook

### **Phase 3: Payment Confirmation** (Step 4)
- Verify payment webhook
- Update booking status
- Convert locked seats to booked
- Generate tickets with QR codes
- Send confirmation

### **Phase 4: Ticket Management** (Step 5)
- Ticket generation with QR codes
- Ticket validation endpoint
- Ticket download/email

---

## 🎯 Next Steps

1. **Decide Payment Gateway:**
   - Razorpay (India) - Recommended
   - Stripe (International)
   - PayPal (Alternative)

2. **Implement Booking Creation:**
   - Create booking service
   - Create booking controller
   - Create booking routes

3. **Implement Payment Flow:**
   - Payment gateway integration
   - Webhook handling
   - Payment verification

4. **Implement Ticket Generation:**
   - QR code generation
   - Ticket storage
   - Ticket retrieval

---

## ❓ Questions to Answer

1. **Which payment gateway?** (Razorpay/Stripe/PayPal)
2. **Payment timeout?** (How long to wait for payment after booking creation?)
3. **Refund policy?** (Can users cancel bookings?)
4. **Ticket storage?** (Separate tickets table or generate on-demand?)
5. **Email/SMS notifications?** (Send confirmation emails?)

---

## 📌 Summary

**Current State:**
- ✅ Seat locking works
- ❌ Booking creation needed
- ❌ Payment integration needed
- ❌ Ticket generation needed

**Flow:**
1. Lock seats (✅ Done)
2. Create booking (❌ TODO)
3. Process payment (❌ TODO)
4. Confirm booking & generate tickets (❌ TODO)

**Key Point:** Seats remain `locked` until payment is confirmed. Only after successful payment, seats become `booked` and tickets are generated.


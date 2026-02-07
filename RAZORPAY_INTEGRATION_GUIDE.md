# 💳 Razorpay Payment Integration Guide

## 📋 Overview

This guide explains how to integrate Razorpay payment gateway with the booking system. The backend handles payment order creation and webhook verification, while the frontend handles the checkout UI.

---

## 🔧 Backend Setup

### 1. Install Dependencies

```bash
npm install razorpay
```

### 2. Environment Variables

Add these to your `.env` file:

```env
# Razorpay Configuration
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
```

**How to get Razorpay credentials:**
1. Sign up at [Razorpay Dashboard](https://dashboard.razorpay.com/)
2. Go to **Settings** → **API Keys**
3. Generate **Test Key** (for development) or **Live Key** (for production)
4. Copy `Key ID` and `Key Secret`
5. For webhook secret: Go to **Settings** → **Webhooks** → Create webhook → Copy secret

### 3. Webhook Configuration

In Razorpay Dashboard:
1. Go to **Settings** → **Webhooks**
2. Click **Add New Webhook**
3. Set **Webhook URL**: `https://your-domain.com/api/v1/payments/webhook`
4. Select events:
   - ✅ `payment.captured`
   - ✅ `payment.authorized`
   - ✅ `payment.failed`
5. Copy the **Webhook Secret** and add to `.env`

---

## 🎯 Payment Flow

### Step 1: User Creates Booking

```http
POST /api/v1/bookings/create
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "event_id": 1,
  "seat_details": [
    {
      "seat_label": "V1",
      "seat_type_id": 1
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "booking": {
      "id": 123,
      "booking_reference": "BKG-2026-0120-143025-A1B2",
      "total_amount": 500.00,
      "status": "pending",
      "payment_status": "pending"
    }
  }
}
```

### Step 2: Create Razorpay Order

```http
POST /api/v1/payments/create-order
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "booking_id": 123,
  "amount": 500.00,
  "currency": "INR"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "order_id": "order_xxxxxxxxxxxxx",
    "amount": 50000,
    "currency": "INR",
    "receipt": "BKG-2026-0120-143025-A1B2",
    "status": "created",
    "key_id": "rzp_test_xxxxxxxxxxxxx",
    "checkout_options": {
      "key": "rzp_test_xxxxxxxxxxxxx",
      "amount": 50000,
      "currency": "INR",
      "name": "Event Booking",
      "description": "Booking: BKG-2026-0120-143025-A1B2",
      "order_id": "order_xxxxxxxxxxxxx",
      "theme": {
        "color": "#3399cc"
      }
    }
  }
}
```

### Step 3: Frontend - Initialize Razorpay Checkout

**Install Razorpay Checkout:**

```bash
# For React/Next.js
npm install razorpay

# For vanilla JavaScript
# Include script tag in HTML
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
```

**React/Next.js Example:**

```tsx
import Razorpay from 'razorpay';

const handlePayment = async (bookingId: number, amount: number) => {
  try {
    // 1. Create order on backend
    const response = await fetch('/api/v1/payments/create-order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        booking_id: bookingId,
        amount: amount,
        currency: 'INR'
      })
    });

    const { data } = await response.json();
    const { order_id, key_id, checkout_options } = data;

    // 2. Initialize Razorpay checkout
    const options = {
      key: key_id,
      amount: checkout_options.amount,
      currency: checkout_options.currency,
      name: checkout_options.name,
      description: checkout_options.description,
      order_id: order_id,
      handler: async function (response: any) {
        // Payment successful - verify on backend
        await verifyPayment(response);
      },
      prefill: {
        name: user.name,
        email: user.email,
        contact: user.phone
      },
      theme: {
        color: checkout_options.theme.color
      },
      modal: {
        ondismiss: function() {
          // User closed the checkout
          console.log('Checkout closed');
        }
      }
    };

    const razorpay = new Razorpay(options);
    razorpay.open();

  } catch (error) {
    console.error('Payment error:', error);
  }
};

// Verify payment after successful checkout
const verifyPayment = async (razorpayResponse: any) => {
  try {
    // Option 1: Poll backend to check payment status
    const checkStatus = async () => {
      const response = await fetch(
        `/api/v1/payments/verify/${razorpayResponse.razorpay_order_id}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );
      
      const { data } = await response.json();
      
      if (data.is_confirmed) {
        // Booking confirmed! Show success message
        console.log('Booking confirmed!', data);
        // Redirect to booking confirmation page
      } else {
        // Payment pending, check again after 2 seconds
        setTimeout(checkStatus, 2000);
      }
    };

    // Start polling
    checkStatus();

    // Option 2: Wait for WebSocket event (if using WebSocket)
    // The backend will broadcast 'booking_confirmed' event
    // Listen to it and update UI accordingly

  } catch (error) {
    console.error('Verification error:', error);
  }
};
```

**Vanilla JavaScript Example:**

```html
<!DOCTYPE html>
<html>
<head>
  <title>Razorpay Checkout</title>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
</head>
<body>
  <button onclick="initiatePayment()">Pay Now</button>

  <script>
    async function initiatePayment() {
      try {
        // 1. Create order
        const response = await fetch('/api/v1/payments/create-order', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessToken
          },
          body: JSON.stringify({
            booking_id: 123,
            amount: 500.00,
            currency: 'INR'
          })
        });

        const { data } = await response.json();

        // 2. Initialize Razorpay
        const options = {
          key: data.key_id,
          amount: data.amount,
          currency: data.currency,
          name: data.checkout_options.name,
          description: data.checkout_options.description,
          order_id: data.order_id,
          handler: function (response) {
            // Payment successful
            verifyPayment(response);
          },
          theme: {
            color: '#3399cc'
          }
        };

        const razorpay = new Razorpay(options);
        razorpay.open();

      } catch (error) {
        console.error('Error:', error);
      }
    }

    function verifyPayment(response) {
      // Poll backend to check payment status
      const interval = setInterval(async () => {
        const res = await fetch(
          `/api/v1/payments/verify/${response.razorpay_order_id}`,
          {
            headers: {
              'Authorization': 'Bearer ' + accessToken
            }
          }
        );
        
        const { data } = await res.json();
        
        if (data.is_confirmed) {
          clearInterval(interval);
          alert('Booking confirmed!');
          // Redirect to success page
        }
      }, 2000);
    }
  </script>
</body>
</html>
```

### Step 4: Backend Webhook Processing

When payment is successful, Razorpay sends a webhook to:
```
POST /api/v1/payments/webhook
```

The backend automatically:
1. ✅ Verifies webhook signature (security)
2. ✅ Confirms booking
3. ✅ Converts seats from 'locked' to 'booked'
4. ✅ Generates tickets with QR codes
5. ✅ Broadcasts 'booking_confirmed' event via WebSocket

**No frontend action needed** - webhook handles everything!

---

## 🔒 Security Features

### 1. Webhook Signature Verification

All webhooks are verified using HMAC SHA256 signature. Invalid signatures are rejected.

### 2. Amount Verification

Backend verifies that payment amount matches booking total before confirming.

### 3. Idempotency

Multiple webhook calls for the same payment are handled safely (idempotent).

---

## 📡 WebSocket Events

The backend broadcasts these events when booking is confirmed:

```javascript
// Listen for booking confirmation
socket.on('booking_confirmed', (data) => {
  console.log('Booking confirmed:', data);
  // Update UI, show success message, etc.
});
```

**Event Data:**
```json
{
  "booking_id": 123,
  "booking_reference": "BKG-2026-0120-143025-A1B2",
  "event_id": 1,
  "total_tickets": 2,
  "status": "confirmed"
}
```

---

## 🧪 Testing

### Test Mode

1. Use **Test Keys** from Razorpay Dashboard
2. Use test card numbers:
   - **Success**: `4111 1111 1111 1111`
   - **CVV**: Any 3 digits
   - **Expiry**: Any future date
   - **Name**: Any name

### Test Webhooks Locally

Use [ngrok](https://ngrok.com/) to expose local server:

```bash
# Install ngrok
npm install -g ngrok

# Start your server
npm run dev

# In another terminal, expose port 3000
ngrok http 3000

# Copy the ngrok URL (e.g., https://abc123.ngrok.io)
# Add to Razorpay webhook URL: https://abc123.ngrok.io/api/v1/payments/webhook
```

---

## 🚀 Production Checklist

- [ ] Switch to **Live Keys** in Razorpay Dashboard
- [ ] Update `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in production `.env`
- [ ] Configure production webhook URL in Razorpay Dashboard
- [ ] Set `RAZORPAY_WEBHOOK_SECRET` in production `.env`
- [ ] Test payment flow end-to-end
- [ ] Monitor webhook logs for errors
- [ ] Set up error alerts for failed payments

---

## 📝 API Endpoints

### Create Payment Order
```
POST /api/v1/payments/create-order
Authorization: Bearer <token>
Body: { booking_id, amount, currency }
```

### Verify Payment Status
```
GET /api/v1/payments/verify/:orderId
Authorization: Bearer <token>
```

### Webhook (Razorpay calls this)
```
POST /api/v1/payments/webhook
Headers: x-razorpay-signature
Body: Razorpay webhook payload
```

---

## 🐛 Troubleshooting

### Payment Not Confirming

1. **Check webhook URL** - Must be publicly accessible
2. **Verify webhook secret** - Must match Razorpay dashboard
3. **Check webhook logs** - View in Razorpay Dashboard → Webhooks → Logs
4. **Verify signature** - Backend logs will show signature verification errors

### Common Errors

- **"Invalid webhook signature"** → Check `RAZORPAY_WEBHOOK_SECRET`
- **"Booking not found"** → Order ID mismatch
- **"Amount mismatch"** → Payment amount doesn't match booking total

---

## 📚 Resources

- [Razorpay Documentation](https://razorpay.com/docs/)
- [Razorpay Checkout Integration](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/)
- [Razorpay Webhooks](https://razorpay.com/docs/webhooks/)

---

## ✅ Summary

1. **Backend** creates Razorpay order
2. **Frontend** opens Razorpay checkout UI
3. **User** completes payment
4. **Razorpay** sends webhook to backend
5. **Backend** verifies and confirms booking
6. **Frontend** receives WebSocket event or polls status

**Key Point:** Frontend only handles UI. All payment verification and booking confirmation happens via secure webhooks on the backend.


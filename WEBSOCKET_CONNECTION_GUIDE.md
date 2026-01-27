# WebSocket Connection Guide

## Server Information
- **Protocol:** HTTP (not HTTPS)
- **WebSocket URL:** `ws://localhost:3000` (NOT `wss://`)
- **Port:** 3000 (default)

## Connection Methods

### 1. Postman Connection

**Steps:**
1. Open Postman
2. Click **"New"** → Select **"WebSocket Request"**
3. Enter URL: `ws://localhost:3000` (NOT `wss://`)
4. Click **"Connect"**

**Authentication:**
- Go to **"Headers"** tab
- Add header: `Authorization: Bearer YOUR_JWT_TOKEN`
- OR use **"Auth"** tab → Select **"Bearer Token"** → Enter token

**Sending Messages:**
1. Go to **"Message"** tab
2. Select message type: **"JSON"**
3. Enter your message:
```json
{
  "eventId": 123,
  "seatTypeId": 1,
  "seat_label": "V2"
}
```
4. Click **"Send"**

**Example Messages:**

**Lock Seat:**
```json
{
  "eventId": 123,
  "seatTypeId": 1,
  "seat_label": "V2"
}
```
Event name: `lock_seat`

**Create Seat Type:**
```json
{
  "eventId": 123,
  "name": "VIP",
  "description": "VIP seats",
  "price": 1000.00,
  "quantity": 50
}
```
Event name: `create_seat_type`

**Update Seat Type:**
```json
{
  "eventId": 123,
  "seatTypeId": 1,
  "price": 1200.00,
  "quantity": 60
}
```
Event name: `update_seat_type`

**Delete Seat Type:**
```json
{
  "eventId": 123,
  "seatTypeId": 1
}
```
Event name: `delete_seat_type`

---

### 2. Frontend Connection (JavaScript/TypeScript)

#### Basic Connection
```javascript
import { io } from 'socket.io-client';

// Connect to server
const socket = io('http://localhost:3000', {
  auth: {
    token: 'your-jwt-access-token' // Optional for authenticated operations
  },
  transports: ['websocket', 'polling'] // Socket.IO will auto-upgrade
});

// Connection events
socket.on('connect', () => {
  console.log('Connected! Socket ID:', socket.id);
});

socket.on('disconnect', () => {
  console.log('Disconnected');
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
});
```

#### With Authentication
```javascript
const socket = io('http://localhost:3000', {
  auth: {
    token: localStorage.getItem('accessToken') // Your JWT token
  },
  transports: ['websocket', 'polling']
});
```

#### Sending Requests
```javascript
// Lock seat
socket.emit('lock_seat', {
  eventId: 123,
  seatTypeId: 1,
  seat_label: 'V2'
});

// Create seat type
socket.emit('create_seat_type', {
  eventId: 123,
  name: 'VIP',
  description: 'VIP seats',
  price: 1000.00,
  quantity: 50
});
```

#### Listening for Responses
```javascript
// Response from your request
socket.on('lock_seat_response', (response) => {
  if (response.success) {
    console.log('Seat locked:', response.data);
  } else {
    console.error('Error:', response.error);
  }
});

// Broadcasts (all clients receive these)
socket.on('seat_locked', (data) => {
  console.log('Seat locked by someone:', data.seat_label);
  console.log('Available quantity:', data.available_quantity);
  // Update your UI here
});

socket.on('seat_type_created', (data) => {
  console.log('New seat type created:', data.seat_type);
  // Update your UI here
});
```

---

### 3. React Hook Example

```jsx
import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

function useWebSocket(token: string) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const newSocket = io('http://localhost:3000', {
      auth: { token },
      transports: ['websocket', 'polling']
    });

    newSocket.on('connect', () => {
      console.log('Connected to WebSocket');
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from WebSocket');
      setIsConnected(false);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [token]);

  return { socket, isConnected };
}

// Usage in component
function SeatComponent() {
  const token = localStorage.getItem('accessToken') || '';
  const { socket, isConnected } = useWebSocket(token);

  const handleLockSeat = () => {
    if (socket && isConnected) {
      socket.emit('lock_seat', {
        eventId: 123,
        seatTypeId: 1,
        seat_label: 'V2'
      });
    }
  };

  useEffect(() => {
    if (!socket) return;

    socket.on('seat_locked', (data) => {
      console.log('Seat locked:', data);
      // Update state
    });

    return () => {
      socket.off('seat_locked');
    };
  }, [socket]);

  return (
    <div>
      <p>Status: {isConnected ? 'Connected' : 'Disconnected'}</p>
      <button onClick={handleLockSeat}>Lock Seat</button>
    </div>
  );
}
```

---

### 4. Testing with cURL (Command Line)

```bash
# Note: cURL doesn't support WebSocket directly
# Use wscat or similar tools instead
```

**Using wscat:**
```bash
# Install wscat
npm install -g wscat

# Connect
wscat -c ws://localhost:3000

# Send message (Socket.IO protocol)
# Note: Socket.IO uses a specific protocol, so raw WebSocket might not work
```

---

### 5. Common Issues & Solutions

#### Issue 1: SSL Error in Postman
**Error:** `WRONG_VERSION_NUMBER` or SSL error
**Solution:** Use `ws://localhost:3000` NOT `wss://localhost:3000`

#### Issue 2: Connection Refused
**Error:** `ECONNREFUSED`
**Solution:** 
- Make sure server is running: `npm start` or `npm run dev`
- Check if port 3000 is available
- Verify server logs show "Socket.IO server initialized"

#### Issue 3: Authentication Required
**Error:** `Authentication required`
**Solution:**
- Make sure you're sending JWT token
- Token should be valid and not expired
- For Postman: Add `Authorization: Bearer YOUR_TOKEN` header

#### Issue 4: CORS Error
**Error:** CORS policy error
**Solution:**
- Server already has CORS enabled for all origins
- If still getting error, check browser console for details

---

### 6. Server Status Check

**Check if server is running:**
```bash
# In terminal
curl http://localhost:3000
# Should return: "Backend is running"
```

**Check server logs:**
When server starts, you should see:
```
Server is running on port 3000
Socket.IO server initialized
```

When client connects:
```
Client connected: <socket-id> (User: <user-id>)
```

---

### 7. Quick Test Script

```javascript
// test-websocket.js
const { io } = require('socket.io-client');

const socket = io('http://localhost:3000', {
  auth: {
    token: 'YOUR_JWT_TOKEN_HERE'
  }
});

socket.on('connect', () => {
  console.log('✅ Connected!');
  
  // Test lock seat
  socket.emit('lock_seat', {
    eventId: 123,
    seatTypeId: 1,
    seat_label: 'V2'
  });
});

socket.on('lock_seat_response', (response) => {
  console.log('Response:', response);
});

socket.on('seat_locked', (data) => {
  console.log('Broadcast received:', data);
});

socket.on('disconnect', () => {
  console.log('❌ Disconnected');
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
});
```

Run: `node test-websocket.js`

---

## Summary

- **Postman:** Use `ws://localhost:3000` (NOT `wss://`)
- **Frontend:** Use `http://localhost:3000` with Socket.IO client
- **Auth:** Pass JWT token via `auth.token` or `Authorization` header
- **Events:** Emit events like `lock_seat`, `create_seat_type`, etc.
- **Listen:** Listen for `*_response` events and broadcast events


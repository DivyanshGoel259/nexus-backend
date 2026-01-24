# WebSocket API Documentation

## Overview
All seat operations are now handled via WebSocket. When website opens, connection automatically establishes and all events broadcast to all connected clients.

## Connection

```javascript
import { io } from 'socket.io-client';

// Connect to server (automatic on website open)
const socket = io('http://localhost:3000', {
  auth: {
    token: 'your-jwt-token' // Optional - for authenticated operations
  },
  transports: ['websocket', 'polling']
});

// Connection events
socket.on('connect', () => {
  console.log('Connected to server');
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
});
```

## Authentication

Token can be passed in two ways:
1. **Via auth object** (recommended):
```javascript
const socket = io('http://localhost:3000', {
  auth: {
    token: 'your-jwt-access-token'
  }
});
```

2. **Via Authorization header**:
```javascript
const socket = io('http://localhost:3000', {
  extraHeaders: {
    Authorization: 'Bearer your-jwt-access-token'
  }
});
```

## WebSocket Events (Emit from Frontend)

### 1. Create Seat Type
**Event:** `create_seat_type`
**Auth Required:** Yes (Organizer only)
**Payload:**
```json
{
  "eventId": 123,
  "name": "VIP",
  "description": "VIP seats",
  "price": 1000.00,
  "quantity": 50
}
```

**Response Event:** `create_seat_type_response`
```json
{
  "success": true,
  "data": {
    "seat_type": { ... },
    "message": "Seat type created successfully"
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Error message"
}
```

**Usage:**
```javascript
socket.emit('create_seat_type', {
  eventId: 123,
  name: 'VIP',
  description: 'VIP seats',
  price: 1000.00,
  quantity: 50
});

socket.on('create_seat_type_response', (response) => {
  if (response.success) {
    console.log('Seat type created:', response.data);
  } else {
    console.error('Error:', response.error);
  }
});
```

### 2. Update Seat Type
**Event:** `update_seat_type`
**Auth Required:** Yes (Organizer only)
**Payload:**
```json
{
  "eventId": 123,
  "seatTypeId": 1,
  "name": "Premium VIP",  // Optional
  "description": "Updated description",  // Optional
  "price": 1200.00,  // Optional
  "quantity": 60  // Optional
}
```

**Response Event:** `update_seat_type_response`
```json
{
  "success": true,
  "data": {
    "seat_type": { ... },
    "message": "Seat type updated successfully"
  }
}
```

**Usage:**
```javascript
socket.emit('update_seat_type', {
  eventId: 123,
  seatTypeId: 1,
  price: 1200.00,
  quantity: 60
});

socket.on('update_seat_type_response', (response) => {
  if (response.success) {
    console.log('Seat type updated:', response.data);
  }
});
```

### 3. Delete Seat Type
**Event:** `delete_seat_type`
**Auth Required:** Yes (Organizer only)
**Payload:**
```json
{
  "eventId": 123,
  "seatTypeId": 1
}
```

**Response Event:** `delete_seat_type_response`
```json
{
  "success": true,
  "data": {
    "message": "Seat type \"VIP\" deleted successfully",
    "deleted_seat_type_id": 1
  }
}
```

**Usage:**
```javascript
socket.emit('delete_seat_type', {
  eventId: 123,
  seatTypeId: 1
});

socket.on('delete_seat_type_response', (response) => {
  if (response.success) {
    console.log('Seat type deleted');
  }
});
```

### 4. Lock Seat
**Event:** `lock_seat`
**Auth Required:** Yes (Any authenticated user)
**Payload:**
```json
{
  "eventId": 123,
  "seatTypeId": 1,
  "seat_label": "V2"
}
```

**Response Event:** `lock_seat_response`
```json
{
  "success": true,
  "data": {
    "lock": {
      "id": 10,
      "event_id": 123,
      "event_seat_type_id": 1,
      "seat_label": "V2",
      "user_id": 5,
      "status": "locked",
      "locked_at": "2026-01-21T10:00:00Z",
      "expires_at": "2026-01-21T10:10:00Z"
    },
    "message": "Seat V2 locked successfully. Lock expires in 10 minutes.",
    "expires_in_seconds": 600
  }
}
```

**Usage:**
```javascript
socket.emit('lock_seat', {
  eventId: 123,
  seatTypeId: 1,
  seat_label: 'V2'
});

socket.on('lock_seat_response', (response) => {
  if (response.success) {
    console.log('Seat locked:', response.data.lock);
  } else {
    console.error('Error:', response.error);
  }
});
```

## Broadcast Events (Listen on Frontend)

All connected clients automatically receive these events:

### 1. Seat Type Created
**Event:** `seat_type_created`
**Payload:**
```json
{
  "event_id": 123,
  "seat_type": {
    "id": 1,
    "event_id": 123,
    "name": "VIP",
    "description": "VIP seats",
    "price": 1000.00,
    "quantity": 50,
    "available_quantity": 50,
    "display_order": 1,
    "created_at": "2026-01-21T10:00:00Z",
    "updated_at": "2026-01-21T10:00:00Z"
  }
}
```

### 2. Seat Type Updated
**Event:** `seat_type_updated`
**Payload:**
```json
{
  "event_id": 123,
  "seat_type": {
    "id": 1,
    "event_id": 123,
    "name": "Premium VIP",
    "price": 1200.00,
    "quantity": 60,
    "available_quantity": 45,
    ...
  }
}
```

### 3. Seat Type Deleted
**Event:** `seat_type_deleted`
**Payload:**
```json
{
  "event_id": 123,
  "seat_type_id": 1,
  "seat_type_name": "VIP"
}
```

### 4. Seat Locked
**Event:** `seat_locked`
**Payload:**
```json
{
  "event_id": 123,
  "seat_type_id": 1,
  "seat_label": "V2",
  "user_id": 5,
  "available_quantity": 49,
  "lock": {
    "id": 10,
    "event_id": 123,
    "event_seat_type_id": 1,
    "seat_label": "V2",
    "user_id": 5,
    "status": "locked",
    "locked_at": "2026-01-21T10:00:00Z",
    "expires_at": "2026-01-21T10:10:00Z"
  }
}
```

## Complete Example

```javascript
import { io } from 'socket.io-client';

class SeatWebSocketManager {
  constructor(token) {
    this.socket = io('http://localhost:3000', {
      auth: { token },
      transports: ['websocket', 'polling']
    });
    
    this.setupListeners();
  }

  setupListeners() {
    // Connection events
    this.socket.on('connect', () => {
      console.log('Connected to server');
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from server');
    });

    // Response listeners
    this.socket.on('create_seat_type_response', (response) => {
      if (response.success) {
        console.log('Seat type created:', response.data);
      } else {
        console.error('Error:', response.error);
      }
    });

    this.socket.on('update_seat_type_response', (response) => {
      if (response.success) {
        console.log('Seat type updated:', response.data);
      }
    });

    this.socket.on('delete_seat_type_response', (response) => {
      if (response.success) {
        console.log('Seat type deleted');
      }
    });

    this.socket.on('lock_seat_response', (response) => {
      if (response.success) {
        console.log('Seat locked:', response.data.lock);
      } else {
        console.error('Error:', response.error);
      }
    });

    // Broadcast listeners (all clients receive these)
    this.socket.on('seat_type_created', (data) => {
      console.log('New seat type created:', data.seat_type);
      // Update UI
    });

    this.socket.on('seat_type_updated', (data) => {
      console.log('Seat type updated:', data.seat_type);
      // Update UI
    });

    this.socket.on('seat_type_deleted', (data) => {
      console.log('Seat type deleted:', data.seat_type_id);
      // Remove from UI
    });

    this.socket.on('seat_locked', (data) => {
      console.log('Seat locked:', data.seat_label);
      console.log('Available quantity:', data.available_quantity);
      // Update seat map and availability
    });

    // Error handler
    this.socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  }

  // Methods to emit events
  createSeatType(eventId, seatTypeData) {
    this.socket.emit('create_seat_type', {
      eventId,
      ...seatTypeData
    });
  }

  updateSeatType(eventId, seatTypeId, updates) {
    this.socket.emit('update_seat_type', {
      eventId,
      seatTypeId,
      ...updates
    });
  }

  deleteSeatType(eventId, seatTypeId) {
    this.socket.emit('delete_seat_type', {
      eventId,
      seatTypeId
    });
  }

  lockSeat(eventId, seatTypeId, seatLabel) {
    this.socket.emit('lock_seat', {
      eventId,
      seatTypeId,
      seat_label: seatLabel
    });
  }

  disconnect() {
    this.socket.disconnect();
  }
}

// Usage
const token = 'your-jwt-token';
const wsManager = new SeatWebSocketManager(token);

// Create seat type
wsManager.createSeatType(123, {
  name: 'VIP',
  description: 'VIP seats',
  price: 1000.00,
  quantity: 50
});

// Lock seat
wsManager.lockSeat(123, 1, 'V2');
```

## React Example

```jsx
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

function SeatManagement({ eventId, token }) {
  const [seatTypes, setSeatTypes] = useState([]);
  const [lockedSeats, setLockedSeats] = useState(new Set());

  useEffect(() => {
    const socket = io('http://localhost:3000', {
      auth: { token },
      transports: ['websocket', 'polling']
    });

    // Listen for broadcasts
    socket.on('seat_type_created', (data) => {
      setSeatTypes(prev => [...prev, data.seat_type]);
    });

    socket.on('seat_type_updated', (data) => {
      setSeatTypes(prev =>
        prev.map(st => st.id === data.seat_type.id ? data.seat_type : st)
      );
    });

    socket.on('seat_type_deleted', (data) => {
      setSeatTypes(prev => prev.filter(st => st.id !== data.seat_type_id));
    });

    socket.on('seat_locked', (data) => {
      setLockedSeats(prev => new Set([...prev, data.seat_label]));
      // Update available quantity
      setSeatTypes(prev =>
        prev.map(st =>
          st.id === data.seat_type_id
            ? { ...st, available_quantity: data.available_quantity }
            : st
        )
      );
    });

    // Cleanup
    return () => {
      socket.disconnect();
    };
  }, [eventId, token]);

  const handleLockSeat = (seatTypeId, seatLabel) => {
    // Emit via WebSocket
    const socket = io('http://localhost:3000', { auth: { token } });
    socket.emit('lock_seat', {
      eventId,
      seatTypeId,
      seat_label: seatLabel
    });
  };

  return (
    <div>
      {/* Your UI */}
    </div>
  );
}
```

## Key Features

1. **Automatic Connection:** Connect when website opens
2. **Global Broadcast:** All events broadcast to all connected clients
3. **No Room Management:** No need to join/leave rooms
4. **Real-time Updates:** All changes reflect immediately
5. **WebSocket Requests:** All operations via WebSocket
6. **HTTP Routes Still Available:** HTTP routes still work for backward compatibility

## Notes

- All operations require authentication (except viewing broadcasts)
- Responses are sent to the requester
- Broadcasts are sent to all connected clients
- Available quantity updates automatically when seats are locked
- No need to manually join event rooms


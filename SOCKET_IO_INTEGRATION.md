# Socket.IO Integration Guide

## Overview
Real-time updates for seat management using Socket.IO. All events are broadcasted to clients connected to the specific event room.

## Server Setup

The Socket.IO server is initialized in `src/index.ts` and runs on the same port as the HTTP server (default: 3000).

## Frontend Connection

```javascript
import { io } from 'socket.io-client';

// Connect to server
const socket = io('http://localhost:3000', {
  transports: ['websocket', 'polling']
});

// Join event room to receive updates for a specific event
socket.emit('join_event', eventId);

// Leave event room when no longer needed
socket.emit('leave_event', eventId);
```

## Socket Events

### 1. Join Event Room
**Emit:** `join_event`
**Payload:** `eventId` (number)
**Description:** Join a room to receive real-time updates for a specific event

```javascript
socket.emit('join_event', 123);
```

### 2. Leave Event Room
**Emit:** `leave_event`
**Payload:** `eventId` (number)
**Description:** Leave the event room

```javascript
socket.emit('leave_event', 123);
```

## Broadcast Events (Listen on Frontend)

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

**Usage:**
```javascript
socket.on('seat_type_created', (data) => {
  console.log('New seat type created:', data.seat_type);
  // Update UI with new seat type
});
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
    "name": "VIP",
    "description": "Updated VIP seats",
    "price": 1200.00,
    "quantity": 60,
    "available_quantity": 45,
    "display_order": 1,
    "created_at": "2026-01-21T10:00:00Z",
    "updated_at": "2026-01-21T10:30:00Z"
  }
}
```

**Usage:**
```javascript
socket.on('seat_type_updated', (data) => {
  console.log('Seat type updated:', data.seat_type);
  // Update UI with updated seat type
});
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

**Usage:**
```javascript
socket.on('seat_type_deleted', (data) => {
  console.log('Seat type deleted:', data.seat_type_id);
  // Remove seat type from UI
});
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

**Usage:**
```javascript
socket.on('seat_locked', (data) => {
  console.log('Seat locked:', data.seat_label);
  console.log('Available quantity:', data.available_quantity);
  // Update UI:
  // - Mark seat as locked
  // - Update available quantity
  // - Show lock indicator
});
```

## Complete Frontend Example

```javascript
import { io } from 'socket.io-client';

class SeatSocketManager {
  constructor(eventId) {
    this.eventId = eventId;
    this.socket = io('http://localhost:3000', {
      transports: ['websocket', 'polling']
    });
    
    this.setupListeners();
    this.joinEvent();
  }

  setupListeners() {
    // Seat type events
    this.socket.on('seat_type_created', (data) => {
      console.log('New seat type:', data.seat_type);
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

    // Seat lock events
    this.socket.on('seat_locked', (data) => {
      console.log('Seat locked:', data.seat_label);
      console.log('Available:', data.available_quantity);
      // Update seat map and availability
    });

    // Connection events
    this.socket.on('connect', () => {
      console.log('Connected to server');
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from server');
    });
  }

  joinEvent() {
    this.socket.emit('join_event', this.eventId);
  }

  leaveEvent() {
    this.socket.emit('leave_event', this.eventId);
  }

  disconnect() {
    this.leaveEvent();
    this.socket.disconnect();
  }
}

// Usage
const socketManager = new SeatSocketManager(123);

// Cleanup when component unmounts
// socketManager.disconnect();
```

## React Example

```jsx
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

function EventSeats({ eventId }) {
  const [seatTypes, setSeatTypes] = useState([]);
  const [lockedSeats, setLockedSeats] = useState(new Set());

  useEffect(() => {
    const socket = io('http://localhost:3000');

    // Join event room
    socket.emit('join_event', eventId);

    // Listen for seat type updates
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

    // Listen for seat locks
    socket.on('seat_locked', (data) => {
      setLockedSeats(prev => new Set([...prev, data.seat_label]));
      // Update seat type available quantity
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
      socket.emit('leave_event', eventId);
      socket.disconnect();
    };
  }, [eventId]);

  return (
    <div>
      {/* Your seat map UI */}
    </div>
  );
}
```

## Notes

1. **Room-based Broadcasting:** Events are only sent to clients who have joined the specific event room using `join_event`.

2. **Automatic Cleanup:** When a client disconnects, they are automatically removed from all rooms.

3. **CORS Configuration:** Make sure to configure CORS properly in production. Currently set to `*` for development.

4. **Error Handling:** Always handle connection errors and reconnection logic in production.

5. **Security:** Consider adding authentication middleware for Socket.IO connections in production.

## Production Considerations

1. **CORS:** Update CORS origin to your frontend domain
2. **Authentication:** Add JWT verification for socket connections
3. **Rate Limiting:** Implement rate limiting for socket events
4. **Reconnection:** Handle automatic reconnection with exponential backoff
5. **Error Handling:** Implement proper error handling and logging


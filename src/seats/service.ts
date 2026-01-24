import db from "../lib/db";
import { emitToAll } from "../lib/socket";

/**
 * Create seat type for an event
 */
export const createSeatType = async (
  eventId: number,
  payload: { name: string; description?: string; price: number; quantity: number },
  organizerId: number
) => {
  try {
    // Verify event exists and user is organizer
    const event = await db.oneOrNone(
      `SELECT id, organizer_id FROM events WHERE id = $1`,
      [eventId]
    );

    if (!event) {
      throw new Error("Event not found");
    }

    const organizerIdInt = parseInt(organizerId.toString());
    const eventOrganizerIdInt = parseInt(event.organizer_id.toString());

    if (eventOrganizerIdInt !== organizerIdInt) {
      throw new Error("You are not authorized to manage seat types for this event");
    }

    const { name, description, price, quantity } = payload;

    if (!name || price === undefined || quantity === undefined) {
      throw new Error("Missing required fields: name, price, quantity");
    }

    if (price < 0) {
      throw new Error("Price must be greater than or equal to 0");
    }

    if (quantity < 0) {
      throw new Error("Quantity must be greater than or equal to 0");
    }

    // Get max display_order for this event
    const maxDisplayOrder = await db.oneOrNone(
      `SELECT MAX(display_order) as max_order FROM event_seat_types WHERE event_id = $1`,
      [eventId],
      (row: any) => row?.max_order || 0
    );

    // Create seat type
    const seatType = await db.one(
      `INSERT INTO event_seat_types(
        event_id, name, description, price, quantity, available_quantity, display_order
      ) 
      VALUES(
        $1, $2, $3, $4, $5, $6, $7
      ) 
      RETURNING id, event_id, name, description, price, quantity, available_quantity, display_order, created_at, updated_at`,
      [
        eventId,
        name,
        description || null,
        parseFloat(price.toString()),
        parseInt(quantity.toString()),
        parseInt(quantity.toString()), // Initially all available
        (maxDisplayOrder || 0) + 1,
      ]
    );

    const result = {
      seat_type: {
        id: seatType.id,
        event_id: seatType.event_id,
        name: seatType.name,
        description: seatType.description,
        price: parseFloat(seatType.price),
        quantity: parseInt(seatType.quantity),
        available_quantity: parseInt(seatType.available_quantity),
        display_order: seatType.display_order,
        created_at: seatType.created_at,
        updated_at: seatType.updated_at,
      },
      message: "Seat type created successfully",
    };

    // Broadcast to all connected clients
    emitToAll('seat_type_created', {
      event_id: eventId,
      seat_type: result.seat_type
    });

    return result;
  } catch (err: any) {
    throw err;
  }
};

/**
 * Update seat type
 */
export const updateSeatType = async (
  eventId: number,
  seatTypeId: number,
  payload: { name?: string; description?: string; price?: number; quantity?: number },
  organizerId: number
) => {
  try {
    // Verify event exists and user is organizer
    const event = await db.oneOrNone(
      `SELECT id, organizer_id FROM events WHERE id = $1`,
      [eventId]
    );

    if (!event) {
      throw new Error("Event not found");
    }

    const organizerIdInt = parseInt(organizerId.toString());
    const eventOrganizerIdInt = parseInt(event.organizer_id.toString());

    if (eventOrganizerIdInt !== organizerIdInt) {
      throw new Error("You are not authorized to manage seat types for this event");
    }

    // Verify seat type exists and belongs to this event
    const existingSeatType = await db.oneOrNone(
      `SELECT id, quantity FROM event_seat_types WHERE id = $1 AND event_id = $2`,
      [seatTypeId, eventId]
    );

    if (!existingSeatType) {
      throw new Error("Seat type not found");
    }

    const { name, description, price, quantity } = payload;

    // Build update query dynamically
    const updateFields: string[] = [];
    const updateParams: any = { seat_type_id: seatTypeId };

    if (name !== undefined) {
      updateFields.push("name = $(name)");
      updateParams.name = name;
    }
    if (description !== undefined) {
      updateFields.push("description = $(description)");
      updateParams.description = description;
    }
    if (price !== undefined) {
      if (price < 0) {
        throw new Error("Price must be greater than or equal to 0");
      }
      updateFields.push("price = $(price)");
      updateParams.price = parseFloat(price.toString());
    }
    if (quantity !== undefined) {
      if (quantity < 0) {
        throw new Error("Quantity must be greater than or equal to 0");
      }

      // Calculate booked seats count
      const bookedCount = await db.one(
        `SELECT COUNT(*) as count
         FROM seats
         WHERE event_seat_type_id = $1 AND status = 'booked'`,
        [seatTypeId],
        (row: any) => parseInt(row.count)
      );

      const newQuantity = parseInt(quantity.toString());
      const newAvailableQuantity = Math.max(0, newQuantity - bookedCount);

      updateFields.push("quantity = $(quantity)");
      updateFields.push("available_quantity = $(available_quantity)");
      updateParams.quantity = newQuantity;
      updateParams.available_quantity = newAvailableQuantity;
    }

    if (updateFields.length === 0) {
      throw new Error("No fields to update");
    }

    // Update seat type
    await db.none(
      `UPDATE event_seat_types SET ${updateFields.join(", ")} WHERE id = $(seat_type_id)`,
      updateParams
    );

    // Get updated seat type
    const updatedSeatType = await db.one(
      `SELECT id, event_id, name, description, price, quantity, available_quantity, display_order, created_at, updated_at
       FROM event_seat_types
       WHERE id = $1`,
      [seatTypeId]
    );

    const result = {
      seat_type: {
        id: updatedSeatType.id,
        event_id: updatedSeatType.event_id,
        name: updatedSeatType.name,
        description: updatedSeatType.description,
        price: parseFloat(updatedSeatType.price),
        quantity: parseInt(updatedSeatType.quantity),
        available_quantity: parseInt(updatedSeatType.available_quantity),
        display_order: updatedSeatType.display_order,
        created_at: updatedSeatType.created_at,
        updated_at: updatedSeatType.updated_at,
      },
      message: "Seat type updated successfully",
    };

    // Broadcast to all connected clients
    emitToAll('seat_type_updated', {
      event_id: eventId,
      seat_type: result.seat_type
    });

    return result;
  } catch (err: any) {
    throw err;
  }
};

/**
 * Delete seat type
 */
export const deleteSeatType = async (
  eventId: number,
  seatTypeId: number,
  organizerId: number
) => {
  try {
    // Verify event exists and user is organizer
    const event = await db.oneOrNone(
      `SELECT id, organizer_id FROM events WHERE id = $1`,
      [eventId]
    );

    if (!event) {
      throw new Error("Event not found");
    }

    const organizerIdInt = parseInt(organizerId.toString());
    const eventOrganizerIdInt = parseInt(event.organizer_id.toString());

    if (eventOrganizerIdInt !== organizerIdInt) {
      throw new Error("You are not authorized to manage seat types for this event");
    }

    // Verify seat type exists and belongs to this event
    const existingSeatType = await db.oneOrNone(
      `SELECT id, name FROM event_seat_types WHERE id = $1 AND event_id = $2`,
      [seatTypeId, eventId]
    );

    if (!existingSeatType) {
      throw new Error("Seat type not found");
    }

    // Check if there are any booked seats for this seat type
    const bookedCount = await db.one(
      `SELECT COUNT(*) as count FROM seats WHERE event_seat_type_id = $1 AND status = 'booked'`,
      [seatTypeId],
      (row: any) => parseInt(row.count)
    );

    if (bookedCount > 0) {
      throw new Error(
        `Cannot delete seat type. There are ${bookedCount} booked seat(s). Please handle bookings first.`
      );
    }

    // Delete seat type (CASCADE will delete related seats and locks)
    await db.none(`DELETE FROM event_seat_types WHERE id = $1`, [seatTypeId]);

    const result = {
      message: `Seat type "${existingSeatType.name}" deleted successfully`,
      deleted_seat_type_id: seatTypeId,
    };

    // Broadcast to all connected clients
    emitToAll('seat_type_deleted', {
      event_id: eventId,
      seat_type_id: seatTypeId,
      seat_type_name: existingSeatType.name
    });

    return result;
  } catch (err: any) {
    throw err;
  }
};

/**
 * Lock a seat for checkout (virtual seats approach)
 * Seat label is provided by frontend (e.g., V2, V3, P1, etc.)
 * Locks the seat for 10 minutes
 */
export const lockSeat = async (
  eventId: number,
  seatTypeId: number,
  userId: number,
  seatLabel: string
) => {
  try {
    // Validate seat label
    if (!seatLabel || typeof seatLabel !== 'string' || seatLabel.trim().length === 0) {
      throw new Error("Seat label is required");
    }

    const trimmedLabel = seatLabel.trim().toUpperCase();

    // Verify event exists
    const event = await db.oneOrNone(
      `SELECT id, status FROM events WHERE id = $1`,
      [eventId]
    );

    if (!event) {
      throw new Error("Event not found");
    }

    if (event.status !== "published") {
      throw new Error("Event is not available for booking");
    }

    // Verify seat type exists and belongs to event
    const seatType = await db.oneOrNone(
      `SELECT id, name, available_quantity, quantity FROM event_seat_types WHERE id = $1 AND event_id = $2`,
      [seatTypeId, eventId]
    );

    if (!seatType) {
      throw new Error("Seat type not found");
    }

    if (parseInt(seatType.available_quantity) <= 0) {
      throw new Error("No seats available for this seat type");
    }

    return await db.tx(async (t) => {
      // 1. Check conflict (O(1) with indexes - no full scans)
      // Check if seat is already booked or locked
      const conflict = await t.oneOrNone(
        `SELECT 1 
         FROM seats s
         WHERE s.event_seat_type_id = $1 
           AND s.seat_label = $2 
           AND (
             (s.status = 'locked' AND s.expires_at > CURRENT_TIMESTAMP) OR
             (s.status = 'booked')
           )
         LIMIT 1`,
        [seatTypeId, trimmedLabel]
      );

      if (conflict) {
        throw new Error(`Seat ${trimmedLabel} is already taken. Please select another seat.`);
      }

      // 2. Check if available_quantity > 0 before locking
      const seatTypeCheck = await t.oneOrNone(
        `SELECT available_quantity FROM event_seat_types WHERE id = $1 AND available_quantity > 0`,
        [seatTypeId]
      );

      if (!seatTypeCheck) {
        throw new Error("No seats available for this seat type");
      }

      // 3. Decrement available_quantity atomically
      const updated = await t.oneOrNone(
        `UPDATE event_seat_types 
         SET available_quantity = available_quantity - 1
         WHERE id = $1 
           AND available_quantity > 0
         RETURNING available_quantity`,
        [seatTypeId]
      );

      if (!updated) {
        throw new Error("No seats available for this seat type");
      }

      // 4. Create lock in seats table (10 minutes expiry)
      const lockedAt = new Date();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      const lock = await t.one(
        `INSERT INTO seats(
          event_id, event_seat_type_id, seat_label, user_id, status, locked_at, expires_at
        ) 
        VALUES($1, $2, $3, $4, 'locked', $5, $6)
        RETURNING id, event_id, event_seat_type_id, seat_label, user_id, locked_at, expires_at, status`,
        [eventId, seatTypeId, trimmedLabel, userId, lockedAt, expiresAt]
      );

      const result = {
        lock: {
          id: lock.id,
          event_id: lock.event_id,
          event_seat_type_id: lock.event_seat_type_id,
          seat_label: lock.seat_label,
          user_id: lock.user_id,
          status: lock.status,
          locked_at: lock.locked_at,
          expires_at: lock.expires_at,
        },
        message: `Seat ${trimmedLabel} locked successfully. Lock expires in 10 minutes.`,
        expires_in_seconds: 600,
      };

      // Broadcast to all connected clients (including organizer)
      emitToAll('seat_locked', {
        event_id: eventId,
        seat_type_id: seatTypeId,
        seat_label: trimmedLabel,
        user_id: userId,
        available_quantity: updated.available_quantity,
        lock: result.lock
      });

      return result;
    });
  } catch (err: any) {
    throw err;
  }
};

/**
 * Cleanup expired seat locks and restore available_quantity
 * This should be called periodically (e.g., via cron job every 5 minutes)
 */
export const cleanupExpiredLocks = async () => {
  try {
    // Direct cleanup query - delete expired locks from seats table
    const result = await db.one(
      `WITH deleted_locks AS (
        DELETE FROM seats
        WHERE status = 'locked' AND expires_at < CURRENT_TIMESTAMP
        RETURNING event_seat_type_id
      ),
      seat_type_counts AS (
        SELECT 
          event_seat_type_id,
          COUNT(*) as expired_count
        FROM deleted_locks
        GROUP BY event_seat_type_id
      )
      UPDATE event_seat_types est
      SET available_quantity = LEAST(
        est.quantity,
        est.available_quantity + COALESCE(stc.expired_count, 0)
      )
      FROM seat_type_counts stc
      WHERE est.id = stc.event_seat_type_id
      RETURNING COUNT(*) as restored_count`,
      [],
      (row: any) => parseInt(row.restored_count || 0)
    );

    return {
      message: "Expired locks cleaned up successfully",
      restored_seat_types: result,
    };
  } catch (err: any) {
    throw err;
  }
};


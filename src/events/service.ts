import db from "../lib/db";

/**
 * Generate seat prefix from seat type name
 * Premium -> P, Standard -> S, VIP -> V
 */
const getSeatPrefix = (seatTypeName: string): string => {
  return seatTypeName.charAt(0).toUpperCase();
};

/**
 * Create event with seat types (Virtual Seats Approach)
 * 
 * VIRTUAL SEATS: Seats are NOT pre-generated
 * - Available seats tracked via event_seat_types.available_quantity
 * - Seats are created on-demand when booked
 * - Temporary locks stored in seats table (status='locked') during checkout
 * - This approach scales to millions of events without millions of seat rows
 */
export const createEvent = async (payload: any) => {
  try {
    const {
      name,
      description,
      start_date,
      end_date,
      image_url,
      location,
      venue_name,
      organizer_id,
      max_tickets_per_user,
      seat_types,
    } = payload;

    // Validate required fields
    if (!name || !description || !start_date || !end_date || !location || !organizer_id) {
      throw new Error("Missing required fields: name, description, start_date, end_date, location, organizer_id");
    }

    if (!seat_types || !Array.isArray(seat_types) || seat_types.length === 0) {
      throw new Error("At least one seat type is required");
    }

    // Start transaction
    return await db.tx(async (t) => {
      // 1. Create event
      const event = await t.one(
        `INSERT INTO events(
          name, description, start_date, end_date, image_url, 
          location, venue_name, organizer_id, max_tickets_per_user
        ) 
        VALUES(
          $(name), $(description), $(start_date), $(end_date), $(image_url),
          $(location), $(venue_name), $(organizer_id), $(max_tickets_per_user)
        ) 
        RETURNING id, name, description, start_date, end_date, image_url, 
                  location, venue_name, organizer_id, status, is_public, 
                  max_tickets_per_user, created_at`,
        {
          name,
          description,
          start_date,
          end_date,
          image_url: image_url || null,
          location,
          venue_name: venue_name || null,
          organizer_id,
          max_tickets_per_user: max_tickets_per_user || 10,
        }
      );

      // 2. Create seat types (Virtual Seats - No pre-generation)
      // Seats will be created on-demand when booked
      // Available seats tracked via event_seat_types.available_quantity
      const createdSeatTypes = [];
      let totalSeatsAvailable = 0;

      for (let i = 0; i < seat_types.length; i++) {
        const seatType = seat_types[i];
        const { name: seatTypeName, description: seatTypeDesc, price, quantity } = seatType;

        if (!seatTypeName || !price || !quantity) {
          throw new Error(`Seat type ${i + 1} is missing required fields: name, price, quantity`);
        }

        const seatQuantity = parseInt(quantity);

        // Create seat type (seats will be virtual until booked)
        const createdSeatType = await t.one(
          `INSERT INTO event_seat_types(
            event_id, name, description, price, quantity, available_quantity, display_order
          ) 
          VALUES(
            $(event_id), $(name), $(description), $(price), $(quantity), $(available_quantity), $(display_order)
          ) 
          RETURNING id, event_id, name, description, price, quantity, available_quantity, display_order`,
          {
            event_id: event.id,
            name: seatTypeName,
            description: seatTypeDesc || null,
            price: parseFloat(price),
            quantity: seatQuantity,
            available_quantity: seatQuantity, // Initially all available (virtual seats)
            display_order: i + 1,
          }
        );

        totalSeatsAvailable += seatQuantity;

        createdSeatTypes.push({
          id: createdSeatType.id,
          name: createdSeatType.name,
          description: createdSeatType.description,
          price: parseFloat(createdSeatType.price),
          quantity: createdSeatType.quantity,
          available_quantity: createdSeatType.available_quantity,
          display_order: createdSeatType.display_order,
        });
      }

      return {
        event: {
          id: event.id,
          name: event.name,
          description: event.description,
          start_date: event.start_date,
          end_date: event.end_date,
          image_url: event.image_url,
          location: event.location,
          venue_name: event.venue_name,
          organizer_id: event.organizer_id,
          status: event.status,
          is_public: event.is_public,
          max_tickets_per_user: event.max_tickets_per_user,
          created_at: event.created_at,
        },
        seat_types: createdSeatTypes,
        total_seats_available: totalSeatsAvailable,
        message: `Event created successfully with ${totalSeatsAvailable} virtual seats. Seats will be generated on-demand when booked.`,
      };
    });
  } catch (err: any) {
    throw err;
  }
};

/**
 * Get all events with pagination (lean endpoint)
 * Industry standard: Returns basic event info + aggregated seat stats in single query
 */
export const getAllEvents = async (options?: {
  status?: string;
  is_public?: boolean;
  organizer_id?: number;
  limit?: number;
  offset?: number;
}) => {
  try {
    const limit = options?.limit || 10; // Default 10 records
    const offset = options?.offset || 0;

    // Single optimized query with aggregations (no N+1)
    let query = `
      SELECT 
        e.id, e.name, e.description, e.start_date, e.end_date, e.image_url,
        e.location, e.venue_name, e.organizer_id, e.status, e.is_public,
        e.max_tickets_per_user, e.created_at, e.updated_at,
        u.name as organizer_name,
        COALESCE(SUM(est.quantity), 0)::INTEGER as total_seats,
        COALESCE(SUM(est.available_quantity), 0)::INTEGER as available_seats,
        COALESCE(SUM(est.quantity - est.available_quantity), 0)::INTEGER as booked_seats
      FROM events e
      LEFT JOIN users u ON e.organizer_id = u.id
      LEFT JOIN event_seat_types est ON e.id = est.event_id
      WHERE 1=1
    `;
    const params: any = { limit, offset };

    if (options?.status) {
      query += ` AND e.status = $(status)`;
      params.status = options.status;
    }

    if (options?.is_public !== undefined) {
      query += ` AND e.is_public = $(is_public)`;
      params.is_public = options.is_public;
    }

    if (options?.organizer_id) {
      query += ` AND e.organizer_id = $(organizer_id)`;
      params.organizer_id = options.organizer_id;
    }

    query += `
      GROUP BY e.id, e.name, e.description, e.start_date, e.end_date, e.image_url,
               e.location, e.venue_name, e.organizer_id, e.status, e.is_public,
               e.max_tickets_per_user, e.created_at, e.updated_at, u.name
      ORDER BY e.created_at ASC
      LIMIT $(limit) OFFSET $(offset)
    `;

    const events = await db.manyOrNone(query, params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(DISTINCT e.id) as total
      FROM events e
      WHERE 1=1
    `;
    const countParams: any = {};

    if (options?.status) {
      countQuery += ` AND e.status = $(status)`;
      countParams.status = options.status;
    }

    if (options?.is_public !== undefined) {
      countQuery += ` AND e.is_public = $(is_public)`;
      countParams.is_public = options.is_public;
    }

    if (options?.organizer_id) {
      countQuery += ` AND e.organizer_id = $(organizer_id)`;
      countParams.organizer_id = options.organizer_id;
    }

    const totalCount = await db.one(countQuery, countParams, (row: any) => parseInt(row.total));

    return {
      events,
      pagination: {
        total: totalCount,
        limit,
        offset,
        has_more: offset + events.length < totalCount,
      },
    };
  } catch (err: any) {
    throw err;
  }
};

/**
 * Get event by ID (lean endpoint - industry standard)
 * Returns: Event details + seat summary counts only (no detailed seat types)
 */
export const getEventById = async (eventId: number) => {
  try {
    // Single optimized query: event + aggregated seat stats
    const event = await db.oneOrNone(
      `SELECT 
        e.id, e.name, e.description, e.start_date, e.end_date, e.image_url,
        e.location, e.venue_name, e.organizer_id, e.status, e.is_public,
        e.max_tickets_per_user, e.created_at, e.updated_at,
        u.name as organizer_name, u.email as organizer_email,
        COALESCE(SUM(est.quantity), 0)::INTEGER as total_seats,
        COALESCE(SUM(est.available_quantity), 0)::INTEGER as available_seats,
        COALESCE(SUM(est.quantity - est.available_quantity), 0)::INTEGER as booked_seats
      FROM events e
      LEFT JOIN users u ON e.organizer_id = u.id
      LEFT JOIN event_seat_types est ON e.id = est.event_id
      WHERE e.id = $1
      GROUP BY e.id, e.name, e.description, e.start_date, e.end_date, e.image_url,
               e.location, e.venue_name, e.organizer_id, e.status, e.is_public,
               e.max_tickets_per_user, e.created_at, e.updated_at, u.name, u.email`,
      [eventId]
    );

    if (!event) {
      throw new Error("Event not found");
    }

    const totalSeats = parseInt(event.total_seats || 0);
    const availableSeats = parseInt(event.available_seats || 0);
    const bookedSeats = parseInt(event.booked_seats || 0);

    return {
      id: event.id,
      name: event.name,
      description: event.description,
      start_date: event.start_date,
      end_date: event.end_date,
      image_url: event.image_url,
      location: event.location,
      venue_name: event.venue_name,
      organizer_id: event.organizer_id,
      organizer_name: event.organizer_name,
      organizer_email: event.organizer_email,
      status: event.status,
      is_public: event.is_public,
      max_tickets_per_user: event.max_tickets_per_user,
      created_at: event.created_at,
      updated_at: event.updated_at,
      total_seats: totalSeats,
      available_seats: availableSeats,
      booked_seats: bookedSeats,
      occupancy_rate: totalSeats > 0 ? ((bookedSeats / totalSeats) * 100).toFixed(2) : "0.00",
    };
  } catch (err: any) {
    throw err;
  }
};

/**
 * Update event (only basic event details, no seat types)
 * Seat types should be managed via separate endpoint
 */
export const updateEvent = async (eventId: number, payload: any, organizerId: number) => {
  try {
    // Verify event exists and user is organizer
    const existingEvent = await db.oneOrNone(
      `SELECT id, organizer_id FROM events WHERE id = $1`,
      [eventId]
    );

    if (!existingEvent) {
      throw new Error("Event not found");
    }

    // Convert both to integers for comparison (userId might be string from middleware)
    const organizerIdInt = parseInt(organizerId.toString());
    const eventOrganizerIdInt = parseInt(existingEvent.organizer_id.toString());

    if (eventOrganizerIdInt !== organizerIdInt) {
      throw new Error("You are not authorized to update this event");
    }

    const {
      name,
      description,
      start_date,
      end_date,
      image_url,
      location,
      venue_name,
      status,
      is_public,
      max_tickets_per_user,
    } = payload;

    // Build update query dynamically
    const updateFields: string[] = [];
    const updateParams: any = { event_id: eventId };

    if (name !== undefined) {
      updateFields.push("name = $(name)");
      updateParams.name = name;
    }
    if (description !== undefined) {
      updateFields.push("description = $(description)");
      updateParams.description = description;
    }
    if (start_date !== undefined) {
      updateFields.push("start_date = $(start_date)");
      updateParams.start_date = start_date;
    }
    if (end_date !== undefined) {
      updateFields.push("end_date = $(end_date)");
      updateParams.end_date = end_date;
    }
    if (image_url !== undefined) {
      updateFields.push("image_url = $(image_url)");
      updateParams.image_url = image_url;
    }
    if (location !== undefined) {
      updateFields.push("location = $(location)");
      updateParams.location = location;
    }
    if (venue_name !== undefined) {
      updateFields.push("venue_name = $(venue_name)");
      updateParams.venue_name = venue_name;
    }
    if (status !== undefined) {
      updateFields.push("status = $(status)");
      updateParams.status = status;
    }
    if (is_public !== undefined) {
      updateFields.push("is_public = $(is_public)");
      updateParams.is_public = is_public;
    }
    if (max_tickets_per_user !== undefined) {
      updateFields.push("max_tickets_per_user = $(max_tickets_per_user)");
      updateParams.max_tickets_per_user = max_tickets_per_user;
    }

    if (updateFields.length === 0) {
      throw new Error("No fields to update");
    }

    // Single update query
    await db.none(
      `UPDATE events SET ${updateFields.join(", ")} WHERE id = $(event_id)`,
      updateParams
    );

    // Get updated event (lean - just basic details)
    const updatedEvent = await db.oneOrNone(
      `SELECT 
        e.id, e.name, e.description, e.start_date, e.end_date, e.image_url,
        e.location, e.venue_name, e.organizer_id, e.status, e.is_public,
        e.max_tickets_per_user, e.created_at, e.updated_at,
        u.name as organizer_name
      FROM events e
      LEFT JOIN users u ON e.organizer_id = u.id
      WHERE e.id = $1`,
      [eventId]
    );

    return {
      event: updatedEvent,
      message: "Event updated successfully",
    };
  } catch (err: any) {
    throw err;
  }
};

/**
 * Delete event (only organizer can delete)
 */
export const deleteEvent = async (eventId: number, organizerId: number) => {
  try {
    // Verify event exists and user is organizer
    const existingEvent = await db.oneOrNone(
      `SELECT id, organizer_id, name FROM events WHERE id = $1`,
      [eventId]
    );

    if (!existingEvent) {
      throw new Error("Event not found");
    }

    // Convert both to integers for comparison (userId might be string from middleware)
    const organizerIdInt = parseInt(organizerId.toString());
    const eventOrganizerIdInt = parseInt(existingEvent.organizer_id.toString());

    if (eventOrganizerIdInt !== organizerIdInt) {
      throw new Error("You are not authorized to delete this event");
    }

    // Check if there are any bookings
    const bookingCount = await db.one(
      `SELECT COUNT(*) as count FROM bookings WHERE event_id = $1 AND status != 'cancelled'`,
      [eventId],
      (row: any) => parseInt(row.count)
    );

    if (bookingCount > 0) {
      throw new Error(
        `Cannot delete event. There are ${bookingCount} active booking(s). Please cancel all bookings first or change event status to 'cancelled'.`
      );
    }

    // Delete event (CASCADE will delete seat_types, seats, bookings, booking_seats)
    await db.none(`DELETE FROM events WHERE id = $1`, [eventId]);

    return {
      message: `Event "${existingEvent.name}" deleted successfully`,
      deleted_event_id: eventId,
    };
  } catch (err: any) {
    throw err;
  }
};


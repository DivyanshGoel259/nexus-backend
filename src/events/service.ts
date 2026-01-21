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
 * - Temporary locks stored in seat_locks table during checkout
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


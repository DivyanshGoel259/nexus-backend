import Router from "express";
import {
  createBooking,
  confirmBooking,
  getBookingById,
  getMyBookings,
  cancelBooking,
  getBookingTickets,
  getTicketStatus,
} from "./controller";
import { authMiddleware } from "../middlewares/auth";

const router = Router();

// Protected routes (require authentication)
router.post("/create", authMiddleware, createBooking);
// Note: confirmBooking endpoint is deprecated - use Razorpay webhooks instead
// router.post("/:id/confirm", authMiddleware, confirmBooking); // DEPRECATED - Use webhooks
router.get("/my-bookings", authMiddleware, getMyBookings);
router.get("/ticket-status/:jobId", authMiddleware, getTicketStatus); // Poll job progress
router.get("/:id/tickets", authMiddleware, getBookingTickets);        // Get generated tickets
router.get("/:id", authMiddleware, getBookingById);
router.post("/:id/cancel", authMiddleware, cancelBooking);

export default router;


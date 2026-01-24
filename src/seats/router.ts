import Router from "express";
import { createSeatType, updateSeatType, deleteSeatType, lockSeat } from "./controller";
import { authMiddleware } from "../middlewares/auth";

const router = Router();

// Seat type management routes (organizer only)
router.post("/:eventId/seat-types", authMiddleware, createSeatType);
router.put("/:eventId/seat-types/:seatTypeId", authMiddleware, updateSeatType);
router.delete("/:eventId/seat-types/:seatTypeId", authMiddleware, deleteSeatType);

// Seat locking route (any authenticated user)
router.post("/:eventId/seat-types/:seatTypeId/lock", authMiddleware, lockSeat);

export default router;


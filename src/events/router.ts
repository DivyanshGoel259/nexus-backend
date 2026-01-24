import Router from "express";
import {
  createEvent,
  getAllEvents,
  getEventById,
  updateEvent,
  deleteEvent,
} from "./controller";
import { authMiddleware } from "../middlewares/auth";

const router = Router();

// Public routes
router.get("/", getAllEvents); // Get all events (with optional filters)
router.get("/:id", getEventById); // Get event by ID

// Protected routes (require authentication)
router.post("/create", authMiddleware, createEvent);
router.put("/:id", authMiddleware, updateEvent); // Update event
router.delete("/:id", authMiddleware, deleteEvent); // Delete event

export default router;


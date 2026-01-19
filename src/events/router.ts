import Router from "express";
import { createEvent } from "./controller";
import { authMiddleware } from "../middlewares/auth";

const router = Router();

// Protected routes (require authentication)
router.post("/create", authMiddleware, createEvent);

export default router;


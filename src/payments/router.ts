import Router from "express";
import { createOrder, handleWebhook, verifyPayment } from "./controller";
import { authMiddleware } from "../middlewares/auth";

const router = Router();

// Create payment order (requires authentication)
router.post("/create-order", authMiddleware, createOrder);

// Webhook endpoint (NO AUTH - Razorpay calls this directly)
// Security is handled via webhook signature verification
router.post("/webhook", handleWebhook);

// Verify payment status (requires authentication)
router.get("/verify/:orderId", authMiddleware, verifyPayment);

export default router;


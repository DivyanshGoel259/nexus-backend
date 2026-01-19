import Router from "express";
import { 
  register, 
  login, 
  logout, 
  resetPassword, 
  refreshToken,
  sendOtp,
  verifyOtp,
  checkUniqueUsername 
} from "./controller";
import { authMiddleware } from "../middlewares/auth";

const router = Router();

// Public routes
router.post("/register", register);
router.post("/login", login);
router.post("/reset-password", resetPassword);
router.post("/refresh-token", refreshToken);

// OTP routes (public) - Use these for phone verification
router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);

// Username check (public)
router.post("/check-unique-username", checkUniqueUsername);

// Protected routes (require authentication)
router.post("/logout", authMiddleware, logout);

export default router;
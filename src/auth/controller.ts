import { Request, Response, NextFunction } from "express";

import * as service from "./service";

export const register = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const data = await service.register(req.body);
    return res.json({ data });
  } catch (err: any) {
    next(err);
  }
};

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const data = await service.login(req.body);
    return res.json({ data });
  } catch (err: any) {
    next(err);
  }
};

export const logout = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = (req as any).userId;
    const accessToken = req.headers.authorization?.split(" ")[1] || "";
    const { refreshToken } = req.body;
    const data = await service.logout(userId, accessToken, refreshToken);
    return res.json({ data });
  } catch (err: any) {
    next(err);
  }
};

export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const data = await service.resetPassword(req.body);
    return res.json({ data });
  } catch (err: any) {
    next(err);
  }
};

// Removed verifyPhone and verifyEmail
// Use OTP-based verification: sendOtp & verifyOtp

export const refreshToken = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      throw new Error("Refresh token is required");
    }
    const data = await service.refreshAccessToken(refreshToken);
    return res.json({ data });
  } catch (err: any) {
    next(err);
  }
};

export const sendOtp = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      throw new Error("Phone number is required");
    }
    const data = await service.sendOtp(phone);
    return res.json({ data });
  } catch (err: any) {
    next(err);
  }
};

export const verifyOtp = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
      throw new Error("Phone number and OTP are required");
    }
    const data = await service.verifyOtp(phone, otp);
    return res.json({ data });
  } catch (err: any) {
    next(err);
  }
};

export const checkUniqueUsername = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { username } = req.body;
    if (!username) {
      throw new Error("Username is required");
    }
    const data = await service.checkUniqueUsername(username);
    return res.json({ data });
  } catch (err: any) {
    next(err);
  }
};


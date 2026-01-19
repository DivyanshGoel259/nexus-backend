import { Request, Response, NextFunction } from "express";
import { isTokenBlacklisted, verifyToken, TokenPayload } from "../lib/helpers/tokenUtils";

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ 
        error: { message: "Access token is required" } 
      });
    }

    const token = authHeader.split(" ")[1];

    // Check if token is blacklisted
    if (await isTokenBlacklisted(token)) {
      return res.status(401).json({ 
        error: { message: "Token has been revoked" } 
      });
    }

    // Verify token
    let decoded: TokenPayload;
    try {
      decoded = verifyToken(token, "access");
    } catch (err) {
      return res.status(401).json({ 
        error: { message: "Invalid or expired access token" } 
      });
    }

    // Check if token type is access
    if (decoded.type !== "access") {
      return res.status(401).json({ 
        error: { message: "Invalid token type" } 
      });
    }

    // Attach userId to request
    (req as any).userId = decoded.userId.toString();

    next();
  } catch (err: any) {
    return res.status(401).json({ 
      error: { message: err.message || "Authentication failed" } 
    });
  }
};


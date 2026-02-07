import db from "../lib/db";
import bcrypt from "bcrypt";
import {
  generateTokens,
  isTokenBlacklisted,
  blacklistToken,
  verifyToken,
  decodeToken,
  TokenPayload,
} from "../lib/helpers/tokenUtils";
import { sendOtpViaRedis, verifyOtpFromRedis } from "../lib/helpers/otpService";
import { cacheRefreshToken } from "../lib/cache/tokenCache";
import {
  validateRegistration,
  validateLogin,
  normalizePhone,
  sanitizeString,
  isValidOTP,
} from "../lib/helpers/validation";

const SALT_ROUNDS = 10;

export const register = async (payload: any) => {
  try {
    const { username, name, email, phone, password, address, city, state, zip, country } = payload;

    // Validate input
    const validation = validateRegistration({
      username,
      email,
      phone: phone ? normalizePhone(phone) : undefined,
      password,
      name,
    });

    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
    }

    // Normalize and sanitize inputs
    const normalizedPhone = phone ? normalizePhone(phone) : null;
    const normalizedEmail = email ? email.toLowerCase().trim() : null;
    const sanitizedName = name ? sanitizeString(name) : null;
    const sanitizedUsername = username ? sanitizeString(username).toLowerCase() : null;

    // Check if user already exists
    const existingUser = await db.oneOrNone(
      `SELECT id FROM users WHERE email = $(email) OR username = $(username) OR phone = $(phone)`,
      { email: normalizedEmail, username: sanitizedUsername, phone: normalizedPhone }
    );

    if (existingUser) {
      throw new Error("User with this email, username or phone already exists");
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert new user
    const newUser = await db.one(
      `INSERT INTO users(username, name, email, phone, password, address, city, state, zip, country) 
       VALUES($(username), $(name), $(email), $(phone), $(password), $(address), $(city), $(state), $(zip), $(country)) 
       RETURNING id, username, name, email, phone, created_at`,
      {
        username: sanitizedUsername,
        name: sanitizedName,
        email: normalizedEmail,
        phone: normalizedPhone,
        password: hashedPassword,
        address: address ? sanitizeString(address) : null,
        city: city ? sanitizeString(city) : null,
        state: state ? sanitizeString(state) : null,
        zip: zip ? sanitizeString(zip) : null,
        country: country ? sanitizeString(country) : null,
      }
    );

    // Generate access and refresh tokens
    const { accessToken, refreshToken } = generateTokens(newUser.id);

    // Store refresh token in database
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

    await db.none(
      `INSERT INTO refresh_tokens(user_id, token, expires_at) VALUES($(userId), $(token), $(expiresAt))`,
      { userId: newUser.id, token: refreshToken, expiresAt }
    );

    // Cache refresh token in Redis for fast lookup
    try {
      await cacheRefreshToken(refreshToken, newUser.id, expiresAt);
    } catch (cacheErr) {
      // Non-critical, DB still has it
      console.error("Failed to cache refresh token:", cacheErr);
    }

    return {
      user: newUser,
      accessToken,
      refreshToken,
      message: "User registered successfully",
    };
  } catch (err: any) {
    throw err;
  }
};

export const login = async (payload: any) => {
  try {
    const { email, password } = payload;

    // Validate input
    const validation = validateLogin({ email, password });
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
    }

    // Find user by email (normalize to lowercase for case-insensitive lookup)
    const user = await db.oneOrNone(
      `SELECT id, username, name, email, phone, password FROM users WHERE email = $(email)`,
      { email: email?.toLowerCase().trim() }
    );

    if (!user) {
      // Generic error to prevent user enumeration
      throw new Error("Invalid email or password");
    }

    // Check if user has a password (might be phone-only user)
    if (!user.password) {
      throw new Error("Invalid email or password");
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new Error("Invalid email or password");
    }

    // Generate access and refresh tokens
    const { accessToken, refreshToken } = generateTokens(user.id);

    // Store refresh token in database
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

    await db.none(
      `INSERT INTO refresh_tokens(user_id, token, expires_at) VALUES($(userId), $(token), $(expiresAt))`,
      { userId: user.id, token: refreshToken, expiresAt }
    );

    // Cache refresh token in Redis for fast lookup
    try {
      await cacheRefreshToken(refreshToken, user.id, expiresAt);
    } catch (cacheErr) {
      // Non-critical, DB still has it
      console.error("Failed to cache refresh token:", cacheErr);
    }

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      accessToken,
      refreshToken,
      message: "Login successful",
    };
  } catch (err: any) {
    throw err;
  }
};

export const logout = async (userId: string, accessToken: string, refreshToken?: string) => {
  try {
    // Decode access token to get expiry
    const decoded = decodeToken(accessToken);
    const accessTokenExpiry = decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 15 * 60 * 1000);

    // Blacklist the access token (Redis + DB)
    await blacklistToken(accessToken, parseInt(userId), accessTokenExpiry);

    // If refresh token is provided, blacklist it and revoke from database
    if (refreshToken) {
      const decodedRefresh = decodeToken(refreshToken);
      const refreshTokenExpiry = decodedRefresh?.exp ? new Date(decodedRefresh.exp * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // Blacklist refresh token (Redis + DB)
      await blacklistToken(refreshToken, parseInt(userId), refreshTokenExpiry);

      // Revoke refresh token in refresh_tokens table (only if not already revoked)
      const revokedCount = await db.result(
        `UPDATE refresh_tokens 
         SET is_revoked = TRUE, updated_at = CURRENT_TIMESTAMP
         WHERE token = $(token) AND is_revoked = FALSE`,
        { token: refreshToken },
        (r) => r.rowCount
      );
      
      if (revokedCount === 0) {
        console.log("⚠️ Refresh token was already revoked or not found");
      }
    }

    // Optionally: Revoke all refresh tokens for this user
    // await db.none(`UPDATE refresh_tokens SET is_revoked = TRUE WHERE user_id = $(userId)`, { userId });

    return {
      message: "Logout successful",
    };
  } catch (err: any) {
    throw err;
  }
};

export const resetPassword = async (payload: any) => {
  try {
    const { email, phone, newPassword, otp } = payload;

    // Validate inputs
    if (!newPassword || newPassword.length < 8) {
      throw new Error("Password must be at least 8 characters long");
    }

    if (!otp) {
      throw new Error("OTP is required for password reset");
    }

    let user;

    // Reset via email or phone (both require OTP)
    if (email) {
      // For email-based reset, you'd typically send OTP via email
      // For now, we'll use phone OTP as a security measure
      throw new Error("Email-based password reset requires phone OTP verification. Please provide phone number.");
    } else if (phone) {
      // Verify OTP via phone
      const otpResult = await verifyOtpFromRedis(phone, otp);
      
      if (!otpResult.success) {
        throw new Error("Invalid OTP. Password reset failed.");
      }

      // Find user by phone
      user = await db.oneOrNone(
        `SELECT id, email FROM users WHERE phone = $(phone)`,
        { phone }
      );

      if (!user) {
        throw new Error("User not found with this phone number");
      }
    } else {
      throw new Error("Email or phone number is required");
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Update password
    await db.none(
      `UPDATE users 
       SET password = $(password), updated_at = CURRENT_TIMESTAMP 
       WHERE id = $(userId)`,
      { password: hashedPassword, userId: user.id }
    );

    // Security: Revoke all existing tokens for this user (force re-login)
    try {
      const { revokeAllUserTokens } = await import("../lib/helpers/tokenCleanup");
      await revokeAllUserTokens(user.id);
      console.log(`✅ All tokens revoked for user ${user.id} after password reset`);
    } catch (revokeErr: any) {
      console.error("⚠️ Failed to revoke tokens after password reset:", revokeErr.message);
      // Non-critical, password is still changed
    }

    return {
      message: "Password reset successful. Please login with your new password.",
      security_note: "All existing sessions have been terminated for security.",
    };
  } catch (err: any) {
    throw err;
  }
};

// Note: Phone verification is now handled by OTP system
// Use sendOtp() and verifyOtp() instead

export const refreshAccessToken = async (refreshToken: string) => {
  try {
    // Check if refresh token is blacklisted
    if (await isTokenBlacklisted(refreshToken)) {
      throw new Error("Refresh token has been revoked");
    }

    // Verify refresh token
    let decoded: TokenPayload;
    try {
      decoded = verifyToken(refreshToken, "refresh");
    } catch (err) {
      throw new Error("Invalid or expired refresh token");
    }

    // Check if token type is refresh
    if (decoded.type !== "refresh") {
      throw new Error("Invalid token type");
    }

    // Check if refresh token exists in database and is not revoked
    const storedToken = await db.oneOrNone(
      `SELECT id, user_id, is_revoked, expires_at FROM refresh_tokens 
       WHERE token = $(token) AND is_revoked = FALSE AND expires_at > NOW()`,
      { token: refreshToken }
    );

    if (!storedToken) {
      throw new Error("Refresh token not found or has been revoked");
    }

    // Generate new access token (using helper function)
    const { accessToken } = generateTokens(decoded.userId);

    return {
      accessToken,
      message: "Access token refreshed successfully",
    };
  } catch (err: any) {
    throw err;
  }
};

export const verifyAccessToken = async (token: string) => {
  try {
    // Check if token is blacklisted
    if (await isTokenBlacklisted(token)) {
      throw new Error("Token has been revoked");
    }

    // Verify access token
    let decoded: TokenPayload;
    try {
      decoded = verifyToken(token, "access");
    } catch (err) {
      throw new Error("Invalid or expired access token");
    }

    // Check if token type is access
    if (decoded.type !== "access") {
      throw new Error("Invalid token type");
    }

    // Get user details
    const user = await db.oneOrNone(
      `SELECT id, username, name, email, phone FROM users WHERE id = $(userId)`,
      { userId: decoded.userId }
    );

    if (!user) {
      throw new Error("User not found");
    }

    return {
      user,
      userId: decoded.userId,
      message: "Token is valid",
    };
  } catch (err: any) {
    throw err;
  }
};

/**
 * Send OTP to phone number (using Redis)
 */
export const sendOtp = async (phone: string) => {
  try {
    // Validate and normalize phone
    const normalizedPhone = normalizePhone(phone);
    
    if (!normalizedPhone || normalizedPhone.length < 10) {
      throw new Error("Invalid phone number format");
    }

    const result = await sendOtpViaRedis(normalizedPhone);
    return result;
  } catch (err: any) {
    throw err;
  }
};



/**
 * Verify OTP for phone number (using Redis)
 * After verification, logs in the user directly
 * If user doesn't exist, creates user with phone
 */
export const verifyOtp = async (phone: string, otp: string) => {
  try {
    // Validate inputs
    if (!isValidOTP(otp)) {
      throw new Error("Invalid OTP format. OTP must be 4-6 digits.");
    }

    // Normalize phone
    const normalizedPhone = normalizePhone(phone);

    // Verify OTP using Twilio Verify
    const otpResult = await verifyOtpFromRedis(normalizedPhone, otp);

    if (!otpResult.success) {
      throw new Error("OTP verification failed");
    }

    // Find user by phone
    let user = await db.oneOrNone(
      `SELECT id, username, name, email, phone FROM users WHERE phone = $(phone)`,
      { phone: normalizedPhone }
    );

    let isNewUser = false;

    // If user doesn't exist, create new user with phone and random username
    if (!user) {
      isNewUser = true;
      // Create user with only phone
      user = await db.one(
        `INSERT INTO users(phone) 
         VALUES($(phone)) 
         RETURNING id, username, name, email, phone, created_at`,
        { phone: normalizedPhone }
      );
    }

    // Generate access and refresh tokens
    const { accessToken, refreshToken } = generateTokens(user.id);

    // Store refresh token in database
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

    await db.none(
      `INSERT INTO refresh_tokens(user_id, token, expires_at) VALUES($(userId), $(token), $(expiresAt))`,
      { userId: user.id, token: refreshToken, expiresAt }
    );

    // Cache refresh token in Redis for fast lookup
    try {
      await cacheRefreshToken(refreshToken, user.id, expiresAt);
    } catch (cacheErr) {
      // Non-critical, DB still has it
      console.error("Failed to cache refresh token:", cacheErr);
    }

    return {
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        phone: user.phone,
      },
      accessToken,
      refreshToken,
      message: isNewUser ? "OTP verified, user created and login successful" : "OTP verified and login successful",
      isNewUser,
    };
  } catch (err: any) {
    throw err;
  }
};

/**
 * Check if username is unique (available)
 */
export const checkUniqueUsername = async (username: string) => {
  try {
    if (!username || username.trim().length === 0) {
      throw new Error("Username is required");
    }

    // Normalize username (lowercase, trim) for consistent lookup
    const normalizedUsername = username.trim().toLowerCase();

    // Check if username exists
    const existingUser = await db.oneOrNone(
      `SELECT id FROM users WHERE username = $(username)`,
      { username: normalizedUsername }
    );

    return {
      isAvailable: !existingUser,
      username: normalizedUsername,
      message: existingUser ? "Username is already taken" : "Username is available",
    };
  } catch (err: any) {
    throw err;
  }
};


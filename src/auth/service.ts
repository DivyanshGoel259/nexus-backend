import db from "../lib/db";
import bcrypt from "bcrypt";
import {
  generateTokens,
  isTokenBlacklisted,
  verifyToken,
  decodeToken,
  TokenPayload,
} from "../lib/helpers/tokenUtils";
import { sendOtpViaRedis, verifyOtpFromRedis } from "../lib/helpers/otpService";

const SALT_ROUNDS = 10;

export const register = async (payload: any) => {
  try {
    const { username, name, email, phone, password, address, city, state, zip, country } = payload;

    // Check if user already exists
    const existingUser = await db.oneOrNone(
      `SELECT id FROM users WHERE email = $(email) OR username = $(username) OR phone = $(phone)`,
      { email, username, phone }
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
        username,
        name : name || null,
        email : email || null,
        phone : phone || null,
        password : hashedPassword || null,
        address: address || null,
        city: city || null,
        state: state || null,
        zip: zip || null,
        country: country || null,
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

    // Find user by email
    const user = await db.oneOrNone(
      `SELECT id, username, name, email, phone, password FROM users WHERE email = $(email)`,
      { email }
    );

    if (!user) {
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

    // Blacklist the access token
    await db.none(
      `INSERT INTO blacklisted_tokens(token, user_id, expires_at) VALUES($(token), $(userId), $(expiresAt))`,
      { token: accessToken, userId: parseInt(userId), expiresAt: accessTokenExpiry }
    );

    // If refresh token is provided, blacklist it and revoke from database
    if (refreshToken) {
      const decodedRefresh = decodeToken(refreshToken);
      const refreshTokenExpiry = decodedRefresh?.exp ? new Date(decodedRefresh.exp * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // Blacklist refresh token
      await db.none(
        `INSERT INTO blacklisted_tokens(token, user_id, expires_at) VALUES($(token), $(userId), $(expiresAt))
         ON CONFLICT (token) DO NOTHING`,
        { token: refreshToken, userId: parseInt(userId), expiresAt: refreshTokenExpiry }
      );

      // Revoke refresh token in refresh_tokens table
      await db.none(
        `UPDATE refresh_tokens SET is_revoked = TRUE WHERE token = $(token)`,
        { token: refreshToken }
      );
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
    const { email, newPassword, verificationCode } = payload;

    // In a real implementation, you would verify the verification code
    // For now, we'll implement a basic version

    // Find user by email
    const user = await db.oneOrNone(
      `SELECT id FROM users WHERE email = $(email)`,
      { email }
    );

    if (!user) {
      throw new Error("User not found");
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Update password
    await db.none(
      `UPDATE users SET password = $(password), updated_at = CURRENT_TIMESTAMP WHERE id = $(userId)`,
      { password: hashedPassword, userId: user.id }
    );

    return {
      message: "Password reset successful",
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
    const result = await sendOtpViaRedis(phone);
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
    // Verify OTP using Twilio Verify
    const otpResult = await verifyOtpFromRedis(phone, otp);

    if (!otpResult.success) {
      throw new Error("OTP verification failed");
    }

    // Find user by phone
    let user = await db.oneOrNone(
      `SELECT id, username, name, email, phone FROM users WHERE phone = $(phone)`,
      { phone }
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
        { phone }
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

    // Check if username exists
    const existingUser = await db.oneOrNone(
      `SELECT id FROM users WHERE username = $(username)`,
      { username: username.trim() }
    );

    return {
      isAvailable: !existingUser,
      username: username.trim(),
      message: existingUser ? "Username is already taken" : "Username is available",
    };
  } catch (err: any) {
    throw err;
  }
};


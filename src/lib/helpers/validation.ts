/**
 * Input Validation Utilities
 * 
 * Validates user inputs for security and data integrity
 * Used across authentication and registration flows
 */

/**
 * Validate email format
 * RFC 5322 compliant email validation
 */
export const isValidEmail = (email: string): boolean => {
  if (!email || typeof email !== "string") {
    return false;
  }

  // RFC 5322 Email regex (simplified but robust)
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  return emailRegex.test(email) && email.length <= 254; // Max email length
};

/**
 * Validate phone number (Indian format + international)
 * Supports: +91XXXXXXXXXX, 91XXXXXXXXXX, XXXXXXXXXX
 */
export const isValidPhone = (phone: string): boolean => {
  if (!phone || typeof phone !== "string") {
    return false;
  }

  // Remove spaces, hyphens, and parentheses
  const cleanPhone = phone.replace(/[\s\-()]/g, "");

  // Indian phone: +91XXXXXXXXXX or 91XXXXXXXXXX or XXXXXXXXXX (10 digits)
  const indianRegex = /^(\+91|91)?[6-9]\d{9}$/;
  
  // International: +XXX... (7-15 digits)
  const internationalRegex = /^\+[1-9]\d{6,14}$/;

  return indianRegex.test(cleanPhone) || internationalRegex.test(cleanPhone);
};

/**
 * Normalize phone number to E.164 format (+91XXXXXXXXXX)
 */
export const normalizePhone = (phone: string): string => {
  if (!phone) return phone;

  const cleanPhone = phone.replace(/[\s\-()]/g, "");

  // If already has country code, return as is
  if (cleanPhone.startsWith("+")) {
    return cleanPhone;
  }

  // Add +91 for Indian numbers (10 digits starting with 6-9)
  if (/^[6-9]\d{9}$/.test(cleanPhone)) {
    return `+91${cleanPhone}`;
  }

  // Add + for numbers starting with country code (91)
  if (cleanPhone.startsWith("91") && cleanPhone.length === 12) {
    return `+${cleanPhone}`;
  }

  return cleanPhone; // Return as is if format unclear
};

/**
 * Validate password strength
 * Requirements:
 * - At least 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 */
export const isStrongPassword = (password: string): { valid: boolean; message: string } => {
  if (!password || typeof password !== "string") {
    return { valid: false, message: "Password is required" };
  }

  if (password.length < 8) {
    return { valid: false, message: "Password must be at least 8 characters long" };
  }

  if (password.length > 128) {
    return { valid: false, message: "Password must be less than 128 characters" };
  }

  // Check for uppercase
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: "Password must contain at least one uppercase letter" };
  }

  // Check for lowercase
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: "Password must contain at least one lowercase letter" };
  }

  // Check for number
  if (!/\d/.test(password)) {
    return { valid: false, message: "Password must contain at least one number" };
  }

  // Check for special character
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return { valid: false, message: "Password must contain at least one special character" };
  }

  return { valid: true, message: "Password is strong" };
};

/**
 * Validate username
 * Requirements:
 * - 3-30 characters
 * - Alphanumeric, underscores, hyphens only
 * - Must start with a letter
 * - No consecutive special characters
 */
export const isValidUsername = (username: string): { valid: boolean; message: string } => {
  if (!username || typeof username !== "string") {
    return { valid: false, message: "Username is required" };
  }

  const trimmed = username.trim();

  if (trimmed.length < 3) {
    return { valid: false, message: "Username must be at least 3 characters long" };
  }

  if (trimmed.length > 30) {
    return { valid: false, message: "Username must be less than 30 characters" };
  }

  // Must start with a letter
  if (!/^[a-zA-Z]/.test(trimmed)) {
    return { valid: false, message: "Username must start with a letter" };
  }

  // Only alphanumeric, underscores, hyphens
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return { valid: false, message: "Username can only contain letters, numbers, underscores, and hyphens" };
  }

  // No consecutive special characters
  if (/[_-]{2,}/.test(trimmed)) {
    return { valid: false, message: "Username cannot have consecutive underscores or hyphens" };
  }

  return { valid: true, message: "Username is valid" };
};

/**
 * Sanitize string input (prevent XSS)
 * Removes dangerous HTML/script tags
 */
export const sanitizeString = (input: string): string => {
  if (!input || typeof input !== "string") {
    return "";
  }

  // Remove HTML tags
  let sanitized = input.replace(/<[^>]*>/g, "");

  // Remove script tags and content
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");

  // Trim whitespace
  sanitized = sanitized.trim();

  return sanitized;
};

/**
 * Validate OTP format
 * 4-6 digit numeric OTP
 */
export const isValidOTP = (otp: string): boolean => {
  if (!otp || typeof otp !== "string") {
    return false;
  }

  return /^\d{4,6}$/.test(otp);
};

/**
 * Comprehensive user registration validation
 */
export const validateRegistration = (data: {
  username?: string;
  email?: string;
  phone?: string;
  password: string;
  name?: string;
}): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  // Validate username (if provided)
  if (data.username) {
    const usernameCheck = isValidUsername(data.username);
    if (!usernameCheck.valid) {
      errors.push(usernameCheck.message);
    }
  }

  // Validate email (if provided)
  if (data.email) {
    if (!isValidEmail(data.email)) {
      errors.push("Invalid email format");
    }
  }

  // Validate phone (if provided)
  if (data.phone) {
    if (!isValidPhone(data.phone)) {
      errors.push("Invalid phone number format");
    }
  }

  // At least one of email or phone required
  if (!data.email && !data.phone) {
    errors.push("Either email or phone number is required");
  }

  // Validate password
  const passwordCheck = isStrongPassword(data.password);
  if (!passwordCheck.valid) {
    errors.push(passwordCheck.message);
  }

  // Validate name (if provided)
  if (data.name) {
    const sanitized = sanitizeString(data.name);
    if (sanitized.length < 2 || sanitized.length > 100) {
      errors.push("Name must be between 2 and 100 characters");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

/**
 * Validate login credentials
 */
export const validateLogin = (data: {
  email?: string;
  phone?: string;
  password?: string;
}): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  // Email or phone required
  if (!data.email && !data.phone) {
    errors.push("Email or phone number is required");
  }

  // Validate email format (if provided)
  if (data.email && !isValidEmail(data.email)) {
    errors.push("Invalid email format");
  }

  // Validate phone format (if provided)
  if (data.phone && !isValidPhone(data.phone)) {
    errors.push("Invalid phone number format");
  }

  // Password required for email/password login
  if (data.email && !data.password) {
    errors.push("Password is required");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};


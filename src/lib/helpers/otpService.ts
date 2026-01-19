import client from "../services/twilio";

/**
 * Send OTP to phone number using Twilio Verify API
 */
export const sendOtpViaRedis = async (phone: string) => {
  try {
    // Validate phone number format (basic validation)
    if (!phone || phone.length < 10) {
      throw new Error("Invalid phone number");
    }

    // Check if Twilio Verify SID is configured
    const verifySid = process.env.TWILIO_VERIFY_SID;
    if (!verifySid) {
      throw new Error("TWILIO_VERIFY_SID is not configured in environment variables");
    }

    if (!client) {
      throw new Error("Twilio client is not initialized");
    }

    // Send OTP using Twilio Verify API
    const verification = await client.verify.v2
      .services(verifySid)
      .verifications.create({
        to: phone,
        channel: "sms",
      });

    return {
      success: true,
      message: "OTP sent successfully",
      status: verification.status,
      expiresIn: "10 minutes", // Twilio Verify default
      ...(process.env.NODE_ENV === "development" && {
        sid: verification.sid,
        to: verification.to,
      }),
    };
  } catch (err: any) {
    console.error("Error sending OTP via Twilio Verify:", err.message);
    throw new Error(`Failed to send OTP: ${err.message}`);
  }
};

/**
 * Verify OTP for phone number using Twilio Verify API
 */
export const verifyOtpFromRedis = async (phone: string, otp: string) => {
  try {
    // Validate inputs
    if (!phone || !otp) {
      throw new Error("Phone number and OTP are required");
    }

    // Check if Twilio Verify SID is configured
    const verifySid = process.env.TWILIO_VERIFY_SID;
    if (!verifySid) {
      throw new Error("TWILIO_VERIFY_SID is not configured in environment variables");
    }

    if (!client) {
      throw new Error("Twilio client is not initialized");
    }

    // Verify OTP using Twilio Verify API
    const verificationCheck = await client.verify.v2
      .services(verifySid)
      .verificationChecks.create({
        to: phone,
        code: otp,
      });

    // Check verification status
    if (verificationCheck.status === "approved") {
      return {
        success: true,
        message: "OTP verified successfully",
        phone,
        status: verificationCheck.status,
      };
    } else {
      throw new Error("Invalid OTP. Please try again.");
    }
  } catch (err: any) {
    console.error("Error verifying OTP via Twilio Verify:", err.message);
    
    // Handle specific Twilio errors
    if (err.code === 20404) {
      throw new Error("OTP not found or expired. Please request a new OTP.");
    } else if (err.code === 60200) {
      throw new Error("Invalid OTP. Please try again.");
    } else if (err.code === 60202) {
      throw new Error("Maximum verification attempts reached. Please request a new OTP.");
    } else {
      throw new Error(`OTP verification failed: ${err.message}`);
    }
  }
};

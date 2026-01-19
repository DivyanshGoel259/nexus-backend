import otpGenerator from "otp-generator";
import bcrypt from "bcryptjs";
import client from "../services/twilio";

export const generateOtp = async () => {
  const otp = otpGenerator.generate(6, {
    digits: true,
    upperCaseAlphabets: false,
    lowerCaseAlphabets: false,
    specialChars: false,
  });

  const hashedOtp = await bcrypt.hash(otp, 10);
  return { otp, hashedOtp };
};

export const sendOtpSms = async (phone: string, otp: string) => {
  try {
    const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
    if (!client) {
      throw new Error("Twilio client is not set");
    }

    if (!twilioPhoneNumber) {
      throw new Error("Twilio phone number is not set");
    }
    await client.messages.create({
      body: `Your OTP is ${otp}. Valid for 5 minutes.`,
      from: twilioPhoneNumber,
      to: phone, // +91XXXXXXXXXX
    });
  } catch (error: any) {
    console.error("Error sending OTP SMS", error);
    throw error;
  }
};

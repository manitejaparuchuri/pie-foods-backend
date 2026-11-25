import Razorpay from "razorpay";
import { localGateway, localPaymentsEnabled } from "../services/local-payments.service";

let razorpayClient: Razorpay | null = null;

export const getRazorpayClient = (): Razorpay => {
  if (process.env.LOCAL_PAYMENT_SIMULATOR === "true") {
    if (!localPaymentsEnabled()) throw new Error("Unsafe local payment simulator configuration");
    return localGateway as unknown as Razorpay;
  }
  const keyId = String(process.env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();

  if (!keyId || !keySecret) {
    throw new Error("Razorpay is not configured. Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET");
  }

  if (!razorpayClient) {
    razorpayClient = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
  }

  return razorpayClient;
};

export default getRazorpayClient;

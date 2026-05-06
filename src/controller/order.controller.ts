import { Response } from "express";
import OrderService from "../services/order.service";
import { AuthRequest } from "../middlewares/auth";
import { COUPON_ERRORS } from "../services/coupon.service";

type PaymentMethod = "RAZORPAY" | "COD";

export const createOrder = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { shippingId, paymentMethod: rawPaymentMethod, coupon_code, couponCode } = req.body;

    if (!shippingId) {
      return res.status(400).json({ message: "Shipping ID is required" });
    }

    const paymentMethod = String(rawPaymentMethod ?? "RAZORPAY").toUpperCase();
    if (paymentMethod !== "RAZORPAY" && paymentMethod !== "COD") {
      return res.status(400).json({ message: "Invalid payment method" });
    }

    const result = await OrderService.createOrder(
      uid,
      String(shippingId),
      paymentMethod as PaymentMethod,
      String(coupon_code || couponCode || "").trim()
    );

    return res.status(201).json({
      message:
        paymentMethod === "COD"
          ? "COD order placed successfully"
          : "Order created successfully",
      orderId: result.orderId,
      totalAmount: result.totalAmount,
      paymentMethod: result.paymentMethod,
      status: result.status,
      coupon: result.coupon,
    });
  } catch (error: any) {
    console.error("CREATE ORDER ERROR:", error?.message || error);

    if (
      error?.message === "Cart is empty" ||
      error?.message === "Invalid shipping address" ||
      Object.values(COUPON_ERRORS).includes(String(error?.message || ""))
    ) {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: "Failed to create order" });
  }
};

export const getMyOrders = async (req: AuthRequest, res: Response) => {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const orders = await OrderService.getOrdersByUser(uid);
    return res.status(200).json(orders);
  } catch (error: any) {
    console.error("GET ORDERS ERROR:", error?.message || error);
    return res.status(500).json({ message: "Failed to load orders" });
  }
};

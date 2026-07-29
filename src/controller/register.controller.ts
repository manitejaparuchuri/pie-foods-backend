import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { isAuthFlowError, registerWithFirebaseAuth } from "../services/firebase-auth.service";
import { notifyCustomerWelcome } from "../services/order-notifications.service";

export const register = async (req: Request, res: Response) => {
  try {
    const { name, email, password, phone, address } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!name || !normalizedEmail || !password) {
      return res.status(400).json({ message: "name, email, password are required" });
    }

    const user = await registerWithFirebaseAuth({
      name: String(name || "").trim(),
      email: normalizedEmail,
      password: String(password || ""),
      phone: phone || null,
      address: address || null,
    });

    const token = jwt.sign(
      { uid: user.uid, role: user.role, email: user.email },
      process.env.JWT_SECRET as string,
      { expiresIn: "1d" }
    );

    // Welcome email (best-effort, never blocks the response).
    notifyCustomerWelcome(user.email || normalizedEmail, user.name || name).catch(
      (err) => console.error("welcome notify (register) failed:", err)
    );

    return res.status(201).json({
      message: "Registration successful",
      user,
      token,
      // Registration always mints a brand-new account — lets the storefront
      // fire the "welcome / 10% off" celebration popup on first signup.
      isNewUser: true,
    });
  } catch (err: any) {
    if (isAuthFlowError(err)) {
      return res.status(err.statusCode).json({ message: err.message });
    }

    if (err?.message === "Email already registered" || err?.code === "auth/email-already-exists") {
      // SECURITY: don't reveal that the email already has an account. A
      // distinctive 409 lets any anonymous caller enumerate the customer
      // base by trying candidate emails. Return the same generic 400 shape
      // as other validation failures. The frontend already surfaces
      // whatever `message` we send.
      // For the rare legitimate user who forgot they already registered:
      // the sign-in form is one tap away below the "Sign up" button and the
      // shipped copy hints at that path.
      return res.status(400).json({
        message: "We couldn't create your account. Please double-check the details or sign in if you already have an account.",
      });
    }

    console.error("REGISTER ERROR:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};

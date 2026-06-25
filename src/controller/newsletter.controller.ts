import { Request, Response } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";

const collection = firestore.collection("newsletter_subscribers");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** POST /api/newsletter/subscribe { email } — idempotent (doc id = email). */
export const subscribeNewsletter = async (req: Request, res: Response) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ message: "A valid email is required" });
    }

    await collection.doc(email).set(
      {
        email,
        source: String(req.body?.source || "site").slice(0, 40),
        created_at: Timestamp.now(),
      },
      { merge: true }
    );

    return res.status(200).json({ message: "Subscribed" });
  } catch (error) {
    console.error("NEWSLETTER SUBSCRIBE ERROR:", error);
    return res.status(500).json({ message: "Could not subscribe right now" });
  }
};

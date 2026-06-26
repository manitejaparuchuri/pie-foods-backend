import { Request, Response } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase";

/* ===================================================================
   Admin In-Panel Notifications
   ===================================================================
   Reads the `admin_notifications` feed written by
   notifyAdminOrderReceived (new-order rows). Lets the admin panel list
   recent notifications, show an unread badge, and mark them read.
   =================================================================== */

const adminNotificationsCollection = firestore.collection("admin_notifications");

const MAX_NOTIFICATIONS = 100;

export const listAdminNotifications = async (_req: Request, res: Response) => {
  try {
    const snap = await adminNotificationsCollection
      .orderBy("created_at", "desc")
      .limit(MAX_NOTIFICATIONS)
      .get();

    let unreadCount = 0;
    const notifications = snap.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const createdAt = data.created_at as Timestamp | undefined;
      const read = data.read === true;
      if (!read) unreadCount += 1;
      return {
        id: doc.id,
        type: String(data.type || "NEW_ORDER"),
        order_id: String(data.order_id || ""),
        order_number: data.order_number ? String(data.order_number) : "",
        total_amount: Number(data.total_amount) || 0,
        customer_email: String(data.customer_email || ""),
        customer_name: String(data.customer_name || ""),
        payment_method: String(data.payment_method || ""),
        created_at: createdAt ? createdAt.toDate().toISOString() : null,
        read,
      };
    });

    return res.json({ notifications, unreadCount });
  } catch (error: any) {
    console.error("LIST ADMIN NOTIFICATIONS ERROR:", error?.message || error);
    return res.status(500).json({ message: "Unable to load notifications" });
  }
};

export const markAdminNotificationRead = async (req: Request, res: Response) => {
  const id = String(req.params.id || "").trim();
  if (!id) {
    return res.status(400).json({ message: "Notification id is required" });
  }

  try {
    await adminNotificationsCollection.doc(id).update({
      read: true,
      read_at: Timestamp.now(),
    });
    return res.json({ message: "ok" });
  } catch (error: any) {
    console.error("MARK ADMIN NOTIFICATION READ ERROR:", error?.message || error);
    return res.status(500).json({ message: "Unable to update notification" });
  }
};

export const markAllAdminNotificationsRead = async (
  _req: Request,
  res: Response
) => {
  try {
    const snap = await adminNotificationsCollection
      .where("read", "==", false)
      .get();

    if (!snap.empty) {
      const now = Timestamp.now();
      const batch = firestore.batch();
      snap.docs.forEach((doc) => {
        batch.update(doc.ref, { read: true, read_at: now });
      });
      await batch.commit();
    }

    return res.json({ message: "ok" });
  } catch (error: any) {
    console.error("MARK ALL ADMIN NOTIFICATIONS READ ERROR:", error?.message || error);
    return res.status(500).json({ message: "Unable to update notifications" });
  }
};

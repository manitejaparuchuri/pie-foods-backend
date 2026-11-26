import crypto from "crypto";
import { firestore } from "../config/firebase";

// Fail closed: the simulator must never connect to a real Firestore project or gateway.
export function localPaymentsEnabled(): boolean {
  return process.env.LOCAL_PAYMENT_SIMULATOR === "true" &&
    process.env.GCLOUD_PROJECT === "demo-pie-crm-local" &&
    process.env.FIRESTORE_EMULATOR_HOST === "firestore:8080" &&
    process.env.RAZORPAY_KEY_ID === "rzp_test_local_placeholder";
}

const orders = firestore.collection("local_gateway_orders");
const payments = firestore.collection("local_gateway_payments");
async function read(collection: FirebaseFirestore.CollectionReference, id: string) {
  if (!localPaymentsEnabled() || !/^(order|pay)_local_[a-f0-9]{32}$/.test(id)) throw new Error("Local payment unavailable");
  const data = (await collection.doc(id).get()).data();
  if (!data) throw new Error("Local payment unavailable");
  return data;
}

export const localGateway = {
  orders: {
    async create(input: any) {
      if (!localPaymentsEnabled()) throw new Error("Simulator disabled");
      const id = `order_local_${crypto.randomBytes(16).toString("hex")}`;
      const row = { ...input, id, status: "created", amount_paid: 0, created_at: Math.floor(Date.now() / 1000) };
      await orders.doc(id).create(row);
      return row;
    },
    fetch: (id: string) => read(orders, id),
    async fetchPayments(id: string) {
      await read(orders, id);
      const rows = await payments.where("order_id", "==", id).get();
      return { count: rows.size, items: rows.docs.map((row) => row.data()) };
    },
  },
  payments: { fetch: (id: string) => read(payments, id) },
};

export async function simulatePayment(id: string, outcome: string) {
  await read(orders, id);
  if (!["success", "failed", "cancelled"].includes(outcome)) throw new Error("Invalid local outcome");
  if (outcome === "cancelled") return { outcome };
  const paymentId = `pay_local_${crypto.randomBytes(16).toString("hex")}`;
  await firestore.runTransaction(async (tx) => {
    const order = (await tx.get(orders.doc(id))).data();
    if (!order || order.status === "paid") throw new Error("Local order already paid or unavailable");
    tx.create(payments.doc(paymentId), { id: paymentId, order_id: id, amount: order.amount, currency: order.currency, status: outcome === "success" ? "captured" : "failed", created_at: Math.floor(Date.now() / 1000) });
    tx.update(orders.doc(id), { status: outcome === "success" ? "paid" : "attempted", amount_paid: outcome === "success" ? order.amount : 0 });
  });
  return { outcome, razorpay_order_id: id, razorpay_payment_id: paymentId,
    razorpay_signature: crypto.createHmac("sha256", String(process.env.RAZORPAY_KEY_SECRET)).update(`${id}|${paymentId}`).digest("hex") };
}

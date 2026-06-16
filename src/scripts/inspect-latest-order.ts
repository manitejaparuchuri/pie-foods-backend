/**
 * Quick diagnostic: print the most recent order doc, so we can see if
 * the new order_number field is being stamped on creation.
 */
import { firestore } from "../config/firebase";

firestore.settings({ preferRest: true });

async function main(): Promise<void> {
  const snap = await firestore
    .collection("orders")
    .orderBy("order_date", "desc")
    .limit(3)
    .get();

  if (snap.empty) {
    console.log("No orders found.");
    return;
  }

  console.log(`\nFound ${snap.size} recent order(s):\n`);
  for (const doc of snap.docs) {
    const d = doc.data();
    console.log("--------------------------------------------");
    console.log("doc_id        :", doc.id);
    console.log("order_number  :", d.order_number || "(missing!)");
    console.log("status        :", d.status);
    console.log("total_amount  :", d.total_amount);
    console.log("order_date    :", d.order_date?.toDate?.()?.toISOString?.() || d.order_date);
    console.log("is_guest      :", d.is_guest || false);
  }
  console.log("--------------------------------------------\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("ERROR:", err);
    process.exit(1);
  });

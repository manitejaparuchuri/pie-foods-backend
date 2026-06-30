import { loadEnv, makeClients } from "./_imgkit.mjs";
const env = loadEnv();
const { db } = await makeClients(env);

const id = process.env.ORDER_ID;
const doc = await db.collection("orders").doc(id).get();
if (!doc.exists) { console.log("not found"); process.exit(0); }
const x = doc.data();
console.log("order keys:", Object.keys(x).join(", "), "\n");
// find arrays of line items and any field whose value contains a products/ url
const items = x.items || x.line_items || x.products || x.cart || [];
console.log("items array field length:", Array.isArray(items) ? items.length : "(not array)");
if (Array.isArray(items)) {
  items.forEach((it, i) => {
    const imgFields = Object.entries(it).filter(([k, v]) => typeof v === "string" && /products\//.test(v));
    console.log(`  item[${i}] name="${it.name || it.product_name || ""}" id=${it.product_id || it.id || ""}`);
    imgFields.forEach(([k, v]) => console.log(`       ${k} = ${v}`));
  });
}
process.exit(0);

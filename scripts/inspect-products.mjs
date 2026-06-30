import { loadEnv, makeClients } from "./_imgkit.mjs";

const env = loadEnv();
const { db } = await makeClients(env);

const col = env.FIREBASE_PRODUCTS_COLLECTION || "products";
const snap = await db.collection(col).get();
console.log(`=== ${col} (${snap.size} docs) ===\n`);

const fields = ["image_url", "image_url1", "image_url2", "image_url3", "image_url4", "image_url5"];
snap.forEach((d) => {
  const x = d.data();
  console.log(`doc=${d.id}  name="${x.name || x.title || ""}"  slug=${x.slug || ""}`);
  for (const f of fields) {
    if (x[f]) console.log(`   ${f} = ${x[f]}`);
  }
  console.log("");
});

// also combos, which may reference product images
const combosCol = env.FIREBASE_COMBOS_COLLECTION || "combos";
const cSnap = await db.collection(combosCol).get().catch(() => null);
if (cSnap && !cSnap.empty) {
  console.log(`\n=== ${combosCol} (${cSnap.size} docs) ===\n`);
  cSnap.forEach((d) => {
    const x = d.data();
    console.log(`doc=${d.id}  name="${x.name || x.title || ""}"`);
    for (let i = 0; i <= 10; i++) {
      const f = i === 0 ? "image_url" : `image_url${i}`;
      if (x[f]) console.log(`   ${f} = ${x[f]}`);
    }
    console.log("");
  });
}

process.exit(0);

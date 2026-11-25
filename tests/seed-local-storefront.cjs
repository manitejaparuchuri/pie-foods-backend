const { firestore } = require('/app/dist/config/firebase');
async function main() {
  if (process.env.FIRESTORE_EMULATOR_HOST !== 'firestore:8080' || process.env.GCLOUD_PROJECT !== 'demo-pie-crm-local') throw Error('Refusing to seed a non-local database');
  const products = [
    { product_id: 424242, name: 'Local Test Monk Fruit Drops', slug: 'local-test-monk-fruit-drops', price: 900, image_url: 'images/promo/monk-fruit-drops-b2g1-1080.webp' },
    { product_id: 424243, name: 'Local Test Sweetener Pack', slug: 'local-test-sweetener-pack', price: 499, image_url: 'images/promo/monk-fruit-drops-b2g1-1080.webp' },
  ];
  for (const product of products) {
    const ref = firestore.collection('products').doc('product-' + product.product_id);
    if (!(await ref.get()).exists) await ref.create({ ...product, description: 'Local test product — no real order or payment. Use dummy customer details.', discount_percent: 0, tax_percent: 5, stock_quantity: 10000, free_shipping: true, is_active: true, category_id: 4242, category_name: 'Local Test Products', category_slug: 'local-test-products' });
  }
  const ref = firestore.collection('categories').doc('category-4242');
  if (!(await ref.get()).exists) await ref.create({ category_id: 4242, name: 'Local Test Products', slug: 'local-test-products', sort_order: 1 });
  console.log('Local test catalogue ready (existing records not overwritten).');
  await firestore.terminate();
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });

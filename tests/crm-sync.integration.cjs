const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('/app/node_modules/jsonwebtoken');
const { Timestamp } = require('firebase-admin/firestore');
const { firestore } = require('/app/dist/config/firebase');
const { runCrmSync, wakeCrmPaymentSync } = require('/app/dist/services/crm-sync.service');
const getRazorpay = require('/app/dist/config/razorpay').default;
const { signRecovery } = require('/app/dist/services/crm-sync-policy');

test('Docker storefront → Firestore outbox → authenticated CRM → abandonment → verified purchase', { timeout: 120000 }, async () => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, 'firestore:8080');
  assert.equal(process.env.GCLOUD_PROJECT, 'demo-pie-crm-local');
  assert.equal(process.env.CRM_API_BASE_URL, 'http://crm:5000/api');
  const runId = Date.now().toString();
  const leadPhone = '986' + runId.slice(-7);
  const guestPhone = '987' + runId.slice(-7);
  const signedPhone = '988' + runId.slice(-7);
  const crmBase = process.env.CRM_API_BASE_URL + '/crm/lifecycle';
  const request = async (url, method = 'GET', body, headers = {}) => {
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    assert.ok(response.ok, `HTTP ${response.status}: ${data.message || 'unexpected response'}`);
    return data;
  };
  const crm = (path, method = 'GET', body) => request(crmBase + path, method, body, { 'X-API-Key': process.env.CRM_API_KEY });
  const local = (path, method = 'GET', body, headers) => request('http://localhost:8080' + path, method, body, headers);
  const outbox = firestore.collection('crm_checkout_sync');
  const productId = 424242;
  await firestore.collection('products').doc(`product-${productId}`).set({ product_id: productId, name: 'Local test drops', price: 900, discount_percent: 0, tax_percent: 5, stock_quantity: 100, free_shipping: true, coupon_excluded: false, is_active: true });

  const leadId = 'test-lead-' + runId;
  await local('/api/leads', 'POST', { leadId, name: 'Local pre-checkout lead', phone: leadPhone, city: 'Hyderabad', items: [{ product_id: productId, quantity: 1, price: 1 }], cartTotal: 1, consent: { status: 'granted' } });
  assert.ok((await outbox.doc('lead-' + leadId).get()).exists);
  const originalBase = process.env.CRM_API_BASE_URL;
  process.env.CRM_API_BASE_URL = 'http://127.0.0.1:1/api';
  await runCrmSync();
  assert.equal((await outbox.doc('lead-' + leadId).get()).data().closed, false);
  process.env.CRM_API_BASE_URL = originalBase;
  await outbox.doc('lead-' + leadId).update({ next_at: Timestamp.fromMillis(0) });
  await runCrmSync();
  const leadState = (await outbox.doc('lead-' + leadId).get()).data();
  assert.ok(leadState.contact_id);
  const leadCustomer = (await crm('/customers/' + leadState.contact_id)).data;
  assert.notEqual(leadCustomer.consent.status, 'granted', 'Public form cannot manufacture consent');

  const guest = await local('/api/orders/guest', 'POST', { name: 'Local guest checkout', phone: guestPhone, email: 'guest-' + runId + '@example.invalid', address: { name: 'Local guest checkout', phone: guestPhone, address: 'Local test address', city: 'Hyderabad', state: 'Telangana', postal_code: '500001' }, items: [{ productId, quantity: 1 }], paymentMethod: 'RAZORPAY' });
  const guestId = guest.orderId;
  assert.equal(guest.totalAmount, 900);
  const guestRef = outbox.doc('order-' + guestId);
  assert.ok((await guestRef.get()).exists, 'Order and intent committed together');
  await firestore.collection('orders').doc(guestId).update({ provider_order_id: 'order_local_' + guestId });
  await guestRef.update({ activity_at: Timestamp.fromMillis(Date.now() - 40 * 60000), next_at: Timestamp.fromMillis(0) });

  let paid = false;
  const client = getRazorpay();
  client.orders.fetch = async (id) => ({ id, currency: 'INR', amount: 90000, amount_paid: paid ? 90000 : 0, status: paid ? 'paid' : 'created' });
  client.orders.fetchPayments = async (id) => ({ count: paid ? 1 : 0, items: paid ? [{ id: 'pay_local', order_id: id, currency: 'INR', amount: 90000, status: 'captured', created_at: Math.floor(Date.now() / 1000) }] : [] });

  // Simulate a lost response AFTER the CRM commits checkout activity.
  const realFetch = global.fetch;
  let lost = false;
  global.fetch = async (url, options) => {
    const response = await realFetch(url, options);
    if (!lost && String(url).endsWith('/checkouts/events')) { lost = true; throw new Error('Simulated lost response'); }
    return response;
  };
  try { await runCrmSync(); } finally { global.fetch = realFetch; }
  const interrupted = (await guestRef.get()).data();
  assert.ok(interrupted.pending_event);
  const savedSequence = interrupted.pending_event.sequence;
  await guestRef.update({ next_at: Timestamp.fromMillis(0) });
  await runCrmSync();
  const delivered = (await guestRef.get()).data();
  assert.equal(delivered.pending_event, undefined);
  assert.equal(delivered.sequence, savedSequence + 1, 'Same activity replayed, followed by one payment check');
  const getGuestRow = async () => (await crm('/checkouts')).data.rows.find((row) => row.reference === guestId);
  let row = await getGuestRow();
  assert.ok(row);
  assert.equal(row.payment_status, 'unpaid');
  assert.equal(row.contact.phone, '91' + guestPhone);
  assert.equal(row.recovery_url, undefined);

  const token = signRecovery(guestId, Date.now() + 60000, process.env.CRM_RECOVERY_SIGNING_SECRET);
  const recoveredCart = await local('/api/checkout/recovery/?token=' + encodeURIComponent(token));
  assert.equal(recoveredCart.orderId, guestId);
  assert.equal(recoveredCart.guestAccessToken, undefined);
  assert.equal(recoveredCart.customer_phone, undefined);
  const invalid = await fetch('http://localhost:8080/api/checkout/recovery/?token=' + encodeURIComponent(token + 'tamper'));
  assert.equal(invalid.status, 404);
  const unauthedCron = await fetch('http://localhost:8080/api/cron/sync-crm', { method: 'POST' });
  assert.equal(unauthedCron.status, 401);

  // Wait for the real CRM worker's next 30-second detection tick; no messages are enabled.
  for (let attempt = 0; attempt < 18; attempt++) {
    row = await getGuestRow();
    if (row.state === 'abandoned') break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert.equal(row.state, 'abandoned');
  assert.equal(row.reminders.length, 0);

  // Server/provider capture, not the public /leads/convert endpoint, drives purchase conversion.
  paid = true;
  await wakeCrmPaymentSync(guestId);
  await runCrmSync();
  row = await getGuestRow();
  assert.equal(row.state, 'recovered');
  assert.equal(row.payment_status, 'paid');
  const paidCustomer = (await crm('/customers/' + row.contact_id)).data;
  assert.equal(paidCustomer.order_count, 1);
  assert.equal((await firestore.collection('orders').doc(guestId).get()).data().status, 'PENDING_PAYMENT', 'CRM bridge does not rewrite storefront payment/stock transactions');

  // Exercise the independent authenticated checkout route with server-priced items.
  const uid = 'local-user-' + runId;
  await firestore.collection('users').doc(uid).set({ name: 'Local signed-in shopper', phone: signedPhone, email: 'user-' + runId + '@example.invalid' });
  await firestore.collection('users').doc(uid).collection('addresses').doc('local-address').set({ name: 'Local signed-in shopper', phone: signedPhone, city: 'Hyderabad' });
  const jwtToken = jwt.sign({ uid, role: 'customer' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const signed = await local('/api/checkout', 'POST', { shipping_id: 'local-address', items: [{ product_id: productId, quantity: 1, price: 1 }] }, { Authorization: 'Bearer ' + jwtToken });
  assert.equal(signed.total_amount, 900);
  assert.ok((await outbox.doc('order-' + signed.order_id).get()).exists);
  await runCrmSync();
  const signedRow = (await crm('/checkouts')).data.rows.find((item) => item.reference === signed.order_id);
  assert.ok(signedRow);
  assert.equal(signedRow.payment_status, 'processing', 'No provider order is not evidence of an unpaid payment');
  console.log('Verified guest and signed-in capture, durable retry/replay, real CRM abandonment, signed recovery access and paid conversion; Razorpay stubbed and messaging disabled.');
  await firestore.terminate();
});

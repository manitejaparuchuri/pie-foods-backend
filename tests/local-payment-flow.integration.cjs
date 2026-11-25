const { test } = require('node:test');
const assert = require('node:assert/strict');
const { firestore } = require('/app/dist/config/firebase');
const { localPaymentsEnabled } = require('/app/dist/services/local-payments.service');
const { signRecovery } = require('/app/dist/services/crm-sync-policy');
const jwt = require('/app/node_modules/jsonwebtoken');

test('local HTTP payment simulator, real order verification and automatic CRM sync', { timeout: 120000 }, async () => {
  assert.equal(localPaymentsEnabled(), true);
  const call = async (url, body, headers = {}) => {
    const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    assert.ok(response.ok, `HTTP ${response.status}: ${data.message || JSON.stringify(data)}`);
    return data;
  };
  const local = (path, body, headers) => call('http://localhost:8080/api' + path, body, headers);
  const crm = (path) => call(process.env.CRM_API_BASE_URL + '/crm/lifecycle' + path, undefined, { 'X-API-Key': process.env.CRM_API_KEY });
  const waitRow = async (id, status) => {
    for (let i = 0; i < 35; i++) {
      const row = (await crm('/checkouts')).data.rows.find((row) => row.reference === id);
      if (row?.payment_status === status) return row;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.fail('CRM did not automatically reach ' + status + ' for ' + id);
  };
  const run = Date.now().toString();
  const results = [];
  for (const [index, outcome] of ['success', 'failed', 'cancelled'].entries()) {
    const phone = '98' + index + run.slice(-7);
    const guest = await local('/orders/guest', { name: 'Local ' + outcome + ' ' + run, phone, email: outcome + '-' + run + '@example.invalid', address: { name: 'Test Shopper', phone, address: 'Local test address', city: 'Hyderabad', state: 'Telangana', postal_code: '500001' }, items: [{ productId: 424242, quantity: 1 }], paymentMethod: 'RAZORPAY' });
    const payment = await local('/payment/guest/create-order', { orderId: guest.orderId, guestAccessToken: guest.guestAccessToken });
    let row = await waitRow(guest.orderId, 'unpaid');
    assert.equal(row.contact.phone, '91' + phone);
    const orderRef = firestore.collection('orders').doc(guest.orderId);
    const token = signRecovery(guest.orderId, Date.now() + 60000, process.env.CRM_RECOVERY_SIGNING_SECRET);
    const recovery = await local('/checkout/recovery?token=' + encodeURIComponent(token));
    assert.equal(recovery.orderId, guest.orderId);
    assert.equal(recovery.guest_access_token, undefined);
    const simulated = await local('/local-payments/complete', { order_id: payment.razorpay_order_id, outcome });
    if (outcome === 'success') {
      const body = { orderId: guest.orderId, guestAccessToken: guest.guestAccessToken, ...simulated };
      const forged = await fetch('http://localhost:8080/api/payment/guest/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, razorpay_signature: 'forged' }) });
      assert.equal(forged.status, 400);
      await local('/payment/guest/verify', body);
      await local('/payment/guest/verify', body);
      row = await waitRow(guest.orderId, 'paid');
      assert.equal(row.state, 'recovered');
      assert.equal((await orderRef.get()).data().status, 'PAID');
      const customer = (await crm('/customers/' + row.contact_id)).data;
      assert.equal(customer.order_count, 1, 'Idempotent verification cannot duplicate a purchase');
      const closed = await fetch('http://localhost:8080/api/checkout/recovery?token=' + encodeURIComponent(token));
      assert.equal(closed.status, 404);
    } else {
      row = await waitRow(guest.orderId, 'unpaid');
      assert.equal((await orderRef.get()).data().status, 'PENDING_PAYMENT');
      assert.notEqual(row.state, 'recovered');
      assert.equal((await crm('/customers/' + row.contact_id)).data.order_count, 0);
    }
    assert.equal(row.reminders.length, 0, 'No real WhatsApp messages');
    results.push({ outcome, phone, order: guest.orderId, crm_payment: row.payment_status, crm_state: row.state });
  }
  console.log(JSON.stringify(results, null, 2));

  // The independent signed-in checkout uses the same provider verification, not the guest endpoint.
  const uid = 'local-signed-' + run;
  const userRef = firestore.collection('users').doc(uid);
  await userRef.set({ name: 'Local signed-in payment test', phone: '983' + run.slice(-7), email: 'signed-' + run + '@example.invalid' });
  await userRef.collection('addresses').doc('test-address').set({ name: 'Test Shopper', phone: '983' + run.slice(-7), city: 'Hyderabad' });
  const headers = { Authorization: 'Bearer ' + jwt.sign({ uid, role: 'customer' }, process.env.JWT_SECRET, { expiresIn: '5m' }) };
  const signed = await local('/checkout', { shipping_id: 'test-address', items: [{ product_id: 424242, quantity: 1 }] }, headers);
  const payment = await local('/payment/create-order', { order_id: signed.order_id }, headers);
  await waitRow(signed.order_id, 'unpaid');
  const simulated = await local('/local-payments/complete', { order_id: payment.razorpay_order_id, outcome: 'success' });
  await local('/payment/verify', { order_id: signed.order_id, ...simulated }, headers);
  assert.equal((await waitRow(signed.order_id, 'paid')).state, 'recovered');
  assert.equal((await firestore.collection('orders').doc(signed.order_id).get()).data().status, 'PAID');
  console.log('Signed-in simulated payment also verified and visible as paid in CRM.');
  await firestore.terminate();
});

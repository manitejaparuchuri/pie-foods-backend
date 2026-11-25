const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyRazorpay, normalizeCrmPhone, signRecovery, readRecovery } = require('/app/dist/services/crm-sync-policy.js');

test('phone normalization matches Indian website numbers to CRM contacts', () => {
  assert.equal(normalizeCrmPhone('98765 43210'), '919876543210');
  assert.equal(normalizeCrmPhone('+91 98765 43210'), '919876543210');
  assert.equal(normalizeCrmPhone('09876543210'), '919876543210');
  assert.equal(normalizeCrmPhone('bad'), '');
});
test('payment verification is fail closed for authorized, partial, missing or conflicting payment data', () => {
  const order = { id: 'order_1', amount: 90000, currency: 'INR', amount_paid: 0, status: 'created' };
  assert.equal(classifyRazorpay(order, { count: 0, items: [] }, 90000), 'unpaid');
  assert.equal(classifyRazorpay({ ...order, status: 'paid', amount_paid: 90000 }, { count: 1, items: [{ order_id: 'order_1', amount: 90000, currency: 'INR', status: 'captured' }] }, 90000), 'paid');
  for (const payment of [{ order_id: 'order_1', amount: 90000, currency: 'INR', status: 'authorized' }, { order_id: 'other', amount: 90000, currency: 'INR', status: 'captured' }, { order_id: 'order_1', amount: 10, currency: 'INR', status: 'captured' }]) assert.equal(classifyRazorpay(order, { count: 1, items: [payment] }, 90000), 'processing');
  assert.equal(classifyRazorpay(order, { count: 2, items: [] }, 90000), 'processing');
  assert.equal(classifyRazorpay(null, null, 90000), 'processing');
});
test('recovery tokens expire, reject tampering and contain no customer or payment credentials', () => {
  const secret = 'local-test-signing-secret-32-characters';
  const token = signRecovery('order_1', 10000, secret);
  assert.equal(readRecovery(token, secret, 9999), 'order_1');
  assert.equal(readRecovery(token, secret, 10000), null);
  assert.equal(readRecovery(`${token}x`, secret, 1), null);
  assert.equal(readRecovery(token, 'wrong-secret', 1), null);
  assert.deepEqual(JSON.parse(Buffer.from(token.split('.')[0], 'base64url')), { id: 'order_1', exp: 10000 });
});

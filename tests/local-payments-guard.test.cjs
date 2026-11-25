const { test } = require('node:test');
const assert = require('node:assert/strict');
// Import only under an explicitly configured local emulator.
const { localPaymentsEnabled } = require('/app/dist/services/local-payments.service');
const gateway = require('/app/dist/config/razorpay').default;
const { firestore } = require('/app/dist/config/firebase');

test('simulator fails closed without its explicit flag, exact emulator, demo project and placeholder key', async () => {
  const keys = ['LOCAL_PAYMENT_SIMULATOR', 'FIRESTORE_EMULATOR_HOST', 'GCLOUD_PROJECT', 'RAZORPAY_KEY_ID'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, { LOCAL_PAYMENT_SIMULATOR: 'true', FIRESTORE_EMULATOR_HOST: 'firestore:8080', GCLOUD_PROJECT: 'demo-pie-crm-local', RAZORPAY_KEY_ID: 'rzp_test_local_placeholder' });
    assert.equal(localPaymentsEnabled(), true);
    for (const [key, bad] of [['LOCAL_PAYMENT_SIMULATOR', 'false'], ['FIRESTORE_EMULATOR_HOST', 'production:8080'], ['GCLOUD_PROJECT', 'live-project'], ['RAZORPAY_KEY_ID', 'rzp_live_forbidden']]) {
      const saved = process.env[key];
      process.env[key] = bad;
      assert.equal(localPaymentsEnabled(), false);
      if (key !== 'LOCAL_PAYMENT_SIMULATOR') assert.throws(() => gateway(), /Unsafe/);
      process.env[key] = saved;
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await firestore.terminate();
  }
});

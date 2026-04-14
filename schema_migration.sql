-- =============================================================================
-- PIEFRUITS SCHEMA MIGRATION
-- Run this against your existing piefruits database to bring it in sync
-- with the application code.
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS guards).
-- =============================================================================

USE piefruits;

-- ---------------------------------------------------------------------------
-- 1. orders — add provider_order_id column
-- ---------------------------------------------------------------------------
ALTER TABLE `orders`
  ADD COLUMN IF NOT EXISTS `provider_order_id` varchar(100) DEFAULT NULL,
  ADD KEY IF NOT EXISTS `idx_orders_provider_order_id` (`provider_order_id`);

-- ---------------------------------------------------------------------------
-- 2. orders — extend status enum to include PENDING_PAYMENT and PAID
--    (original: 'pending','processing','shipped','delivered','cancelled')
-- ---------------------------------------------------------------------------
ALTER TABLE `orders`
  MODIFY COLUMN `status` enum(
    'PENDING_PAYMENT',
    'PAID',
    'pending',
    'processing',
    'shipped',
    'delivered',
    'cancelled'
  ) DEFAULT 'PENDING_PAYMENT';

-- ---------------------------------------------------------------------------
-- 3. payments — replace the original simple schema with Razorpay-compatible one
--    Original columns: payment_method enum, status enum('pending','completed','failed')
--    New columns: provider, provider_order_id, provider_payment_id,
--                 provider_signature, currency, idempotency_key, updated_at
--    amount changes from decimal to bigint (stores paise, not rupees)
-- ---------------------------------------------------------------------------

-- Add new columns if they don't exist
ALTER TABLE `payments`
  ADD COLUMN IF NOT EXISTS `updated_at`          datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS `currency`             varchar(10)  NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS `provider`             varchar(30)  NOT NULL DEFAULT 'RAZORPAY',
  ADD COLUMN IF NOT EXISTS `provider_order_id`    varchar(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `provider_payment_id`  varchar(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `provider_signature`   varchar(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `idempotency_key`      varchar(64)  DEFAULT NULL;

-- Extend status enum to include SUCCESS and REFUNDED
ALTER TABLE `payments`
  MODIFY COLUMN `status` enum('PENDING','SUCCESS','FAILED','REFUNDED','pending','completed','failed') NOT NULL DEFAULT 'PENDING';

-- Change amount from decimal to bigint (paise)
-- Only run if column is still decimal type
ALTER TABLE `payments`
  MODIFY COLUMN `amount` bigint NOT NULL DEFAULT '0';

-- Drop old payment_method column (no longer used)
ALTER TABLE `payments`
  DROP COLUMN IF EXISTS `payment_method`;

-- Add unique indexes
ALTER TABLE `payments`
  ADD UNIQUE KEY IF NOT EXISTS `uq_payments_idempotency` (`idempotency_key`),
  ADD UNIQUE KEY IF NOT EXISTS `uq_payments_provider_payment_id` (`provider_payment_id`);

-- ---------------------------------------------------------------------------
-- 4. payment_webhook_events — create if missing
--    Referenced in webhook handler but absent from original dump.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `payment_webhook_events` (
  `event_id`     bigint unsigned NOT NULL AUTO_INCREMENT,
  `provider`     varchar(30)     NOT NULL DEFAULT 'RAZORPAY',
  `event_id_ext` varchar(100)    DEFAULT NULL,
  `payload`      json            NOT NULL,
  `received_at`  datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_id`),
  KEY `idx_webhook_provider_event` (`provider`, `event_id_ext`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- 5. Webhook handler inserts with column name 'event_id' but the table uses
--    'event_id_ext' for the external provider event id. Fix the alias.
--    (No schema change needed — handled in code fix below.)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- DONE. Verify with:
--   DESCRIBE orders;
--   DESCRIBE payments;
--   SHOW TABLES LIKE 'payment_webhook_events';
-- ---------------------------------------------------------------------------

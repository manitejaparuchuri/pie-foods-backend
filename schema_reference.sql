-- =============================================================================
-- PIEFRUITS DATABASE SCHEMA REFERENCE
-- MySQL dump 10.13  Distrib 8.0.44, for Win64 (x86_64)
-- Host: localhost    Database: piefruits
-- Generated: 2026-04-14
-- =============================================================================
-- This file is the canonical schema reference for audit and future checks.
-- Run schema_migration.sql to bring an existing DB up to date.
-- =============================================================================

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `user_id`       int            NOT NULL AUTO_INCREMENT,
  `name`          varchar(100)   DEFAULT NULL,
  `email`         varchar(100)   DEFAULT NULL,
  `password_hash` varchar(255)   DEFAULT NULL,
  `phone`         varchar(20)    DEFAULT NULL,
  `address`       text,
  `role`          enum('customer','admin') DEFAULT 'customer',
  `created_at`    timestamp      NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `categories`;
CREATE TABLE `categories` (
  `category_id` int          NOT NULL AUTO_INCREMENT,
  `name`        varchar(100) DEFAULT NULL,
  `description` text,
  `image_url`   varchar(255) DEFAULT NULL,
  PRIMARY KEY (`category_id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- products
-- NOTE: image_url1..image_url2 exist in original dump.
--       The application code also references image_url3..image_url10 and
--       is_active — add those via schema_migration.sql if needed.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `products`;
CREATE TABLE `products` (
  `product_id`     int            NOT NULL AUTO_INCREMENT,
  `name`           varchar(100)   DEFAULT NULL,
  `sub_name`       text,
  `description`    text,
  `price`          decimal(10,2)  DEFAULT NULL,
  `stock_quantity` int            DEFAULT NULL,
  `image_url`      varchar(255)   DEFAULT NULL,
  `created_at`     timestamp      NULL DEFAULT CURRENT_TIMESTAMP,
  `category_id`    int            DEFAULT NULL,
  `specifications` text,
  `details`        text,
  `image_url1`     varchar(255)   DEFAULT NULL,
  `image_url2`     varchar(255)   DEFAULT NULL,
  PRIMARY KEY (`product_id`),
  KEY `category_id_idx` (`category_id`),
  CONSTRAINT `category_id` FOREIGN KEY (`category_id`) REFERENCES `categories` (`category_id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=33 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- product_categories  (many-to-many, supplemental)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `product_categories`;
CREATE TABLE `product_categories` (
  `product_id`  int NOT NULL,
  `category_id` int NOT NULL,
  PRIMARY KEY (`product_id`,`category_id`),
  KEY `category_id` (`category_id`),
  CONSTRAINT `product_categories_ibfk_1` FOREIGN KEY (`product_id`)  REFERENCES `products`   (`product_id`),
  CONSTRAINT `product_categories_ibfk_2` FOREIGN KEY (`category_id`) REFERENCES `categories` (`category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- shipping_info
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `shipping_info`;
CREATE TABLE `shipping_info` (
  `shipping_id`  int          NOT NULL AUTO_INCREMENT,
  `user_id`      int          DEFAULT NULL,
  `address`      text,
  `city`         varchar(100) DEFAULT NULL,
  `state`        varchar(100) DEFAULT NULL,
  `postal_code`  varchar(20)  DEFAULT NULL,
  `country`      varchar(100) DEFAULT NULL,
  `phone`        varchar(20)  DEFAULT NULL,
  PRIMARY KEY (`shipping_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `shipping_info_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- coupons
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `coupons`;
CREATE TABLE `coupons` (
  `coupon_id`            bigint unsigned NOT NULL AUTO_INCREMENT,
  `code`                 varchar(50)     NOT NULL,
  `description`          varchar(255)    DEFAULT NULL,
  `discount_type`        enum('PERCENT','FIXED') NOT NULL,
  `discount_value`       decimal(10,2)   NOT NULL,
  `max_discount_amount`  decimal(10,2)   DEFAULT NULL,
  `min_order_amount`     decimal(10,2)   NOT NULL DEFAULT '0.00',
  `starts_at`            datetime        DEFAULT NULL,
  `expires_at`           datetime        DEFAULT NULL,
  `usage_limit_total`    int unsigned    DEFAULT NULL,
  `usage_limit_per_user` int unsigned    DEFAULT NULL,
  `used_count`           int unsigned    NOT NULL DEFAULT '0',
  `is_active`            tinyint(1)      NOT NULL DEFAULT '1',
  `created_at`           datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`coupon_id`),
  UNIQUE KEY `uq_coupons_code` (`code`),
  KEY `idx_coupons_active` (`is_active`,`starts_at`,`expires_at`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- orders
-- AUDIT FIX: status enum extended to include PENDING_PAYMENT and PAID.
--            provider_order_id column added (used by Razorpay flow).
--            Original enum was ('pending','processing','shipped','delivered','cancelled').
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `orders`;
CREATE TABLE `orders` (
  `order_id`               int            NOT NULL AUTO_INCREMENT,
  `user_id`                int            DEFAULT NULL,
  `order_date`             timestamp      NULL DEFAULT CURRENT_TIMESTAMP,
  `status`                 enum('PENDING_PAYMENT','PAID','pending','processing','shipped','delivered','cancelled') DEFAULT 'PENDING_PAYMENT',
  `total_amount`           decimal(10,2)  DEFAULT NULL,
  `shipping_id`            int            DEFAULT NULL,
  `coupon_id`              bigint unsigned DEFAULT NULL,
  `coupon_code`            varchar(50)    DEFAULT NULL,
  `subtotal_amount`        decimal(10,2)  DEFAULT NULL,
  `coupon_discount_amount` decimal(10,2)  NOT NULL DEFAULT '0.00',
  `final_amount`           decimal(10,2)  DEFAULT NULL,
  `provider_order_id`      varchar(100)   DEFAULT NULL,
  PRIMARY KEY (`order_id`),
  KEY `user_id` (`user_id`),
  KEY `shipping_id` (`shipping_id`),
  KEY `fk_orders_coupon` (`coupon_id`),
  KEY `idx_orders_provider_order_id` (`provider_order_id`),
  CONSTRAINT `fk_orders_coupon`  FOREIGN KEY (`coupon_id`)  REFERENCES `coupons`       (`coupon_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `orders_ibfk_1`     FOREIGN KEY (`user_id`)    REFERENCES `users`         (`user_id`),
  CONSTRAINT `orders_ibfk_2`     FOREIGN KEY (`shipping_id`) REFERENCES `shipping_info` (`shipping_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- order_items
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `order_items`;
CREATE TABLE `order_items` (
  `order_item_id` int           NOT NULL AUTO_INCREMENT,
  `order_id`      int           DEFAULT NULL,
  `product_id`    int           DEFAULT NULL,
  `quantity`      int           DEFAULT NULL,
  `price`         decimal(10,2) DEFAULT NULL,
  PRIMARY KEY (`order_item_id`),
  KEY `order_id`   (`order_id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `order_items_ibfk_1` FOREIGN KEY (`order_id`)   REFERENCES `orders`   (`order_id`),
  CONSTRAINT `order_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- payments
-- AUDIT FIX: Original schema had payment_method enum and basic status.
--            Replaced with Razorpay-compatible columns used by the application.
--            Old columns: payment_method enum('credit_card','paypal','bank_transfer'),
--                         status enum('pending','completed','failed')
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `payments`;
CREATE TABLE `payments` (
  `payment_id`           int            NOT NULL AUTO_INCREMENT,
  `order_id`             int            DEFAULT NULL,
  `payment_date`         timestamp      NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           datetime       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `amount`               bigint         NOT NULL DEFAULT '0',
  `currency`             varchar(10)    NOT NULL DEFAULT 'INR',
  `provider`             varchar(30)    NOT NULL DEFAULT 'RAZORPAY',
  `provider_order_id`    varchar(100)   DEFAULT NULL,
  `provider_payment_id`  varchar(100)   DEFAULT NULL,
  `provider_signature`   varchar(255)   DEFAULT NULL,
  `status`               enum('PENDING','SUCCESS','FAILED','REFUNDED') NOT NULL DEFAULT 'PENDING',
  `idempotency_key`      varchar(64)    DEFAULT NULL,
  PRIMARY KEY (`payment_id`),
  UNIQUE KEY `uq_payments_idempotency` (`idempotency_key`),
  UNIQUE KEY `uq_payments_provider_payment_id` (`provider_payment_id`),
  KEY `order_id` (`order_id`),
  CONSTRAINT `payments_ibfk_1` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- payment_webhook_events
-- AUDIT FIX: Table referenced in webhook handler but missing from original dump.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `payment_webhook_events`;
CREATE TABLE `payment_webhook_events` (
  `event_id`    bigint unsigned NOT NULL AUTO_INCREMENT,
  `provider`    varchar(30)     NOT NULL DEFAULT 'RAZORPAY',
  `event_id_ext` varchar(100)   DEFAULT NULL,
  `payload`     json            NOT NULL,
  `received_at` datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_id`),
  KEY `idx_webhook_provider_event` (`provider`, `event_id_ext`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- coupon_usages
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `coupon_usages`;
CREATE TABLE `coupon_usages` (
  `coupon_usage_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `coupon_id`       bigint unsigned NOT NULL,
  `user_id`         bigint unsigned NOT NULL,
  `order_id`        bigint unsigned NOT NULL,
  `code_snapshot`   varchar(50)     NOT NULL,
  `discount_amount` decimal(10,2)   NOT NULL DEFAULT '0.00',
  `redeemed_at`     datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`coupon_usage_id`),
  UNIQUE KEY `uq_coupon_usage_order` (`order_id`),
  KEY `idx_coupon_usage_coupon_user` (`coupon_id`,`user_id`),
  CONSTRAINT `fk_coupon_usages_coupon` FOREIGN KEY (`coupon_id`) REFERENCES `coupons` (`coupon_id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- cart_items
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `cart_items`;
CREATE TABLE `cart_items` (
  `cart_item_id` int       NOT NULL AUTO_INCREMENT,
  `user_id`      int       DEFAULT NULL,
  `product_id`   int       DEFAULT NULL,
  `quantity`     int       DEFAULT NULL,
  `added_at`     timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`cart_item_id`),
  KEY `user_id`    (`user_id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `cart_items_ibfk_1` FOREIGN KEY (`user_id`)    REFERENCES `users`    (`user_id`),
  CONSTRAINT `cart_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- reviews
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `reviews`;
CREATE TABLE `reviews` (
  `review_id`   int       NOT NULL AUTO_INCREMENT,
  `user_id`     int       DEFAULT NULL,
  `product_id`  int       DEFAULT NULL,
  `rating`      int       DEFAULT NULL,
  `comment`     text,
  `review_date` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`review_id`),
  KEY `user_id`    (`user_id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `reviews_ibfk_1` FOREIGN KEY (`user_id`)    REFERENCES `users`    (`user_id`),
  CONSTRAINT `reviews_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`),
  CONSTRAINT `reviews_chk_1`  CHECK ((`rating` between 1 and 5))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;
/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

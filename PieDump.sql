-- MySQL dump 10.13  Distrib 8.0.45, for Win64 (x86_64)
--
-- Host: 127.0.0.1    Database: piefruits
-- ------------------------------------------------------
-- Server version	8.0.45

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

--
-- Table structure for table `cart_items`
--

DROP TABLE IF EXISTS `cart_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cart_items` (
  `cart_item_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `product_id` int DEFAULT NULL,
  `quantity` int DEFAULT NULL,
  `added_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`cart_item_id`),
  KEY `user_id` (`user_id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `cart_items_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `cart_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `cart_items`
--

LOCK TABLES `cart_items` WRITE;
/*!40000 ALTER TABLE `cart_items` DISABLE KEYS */;
/*!40000 ALTER TABLE `cart_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `categories`
--

DROP TABLE IF EXISTS `categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `categories` (
  `category_id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) DEFAULT NULL,
  `description` text,
  `image_url` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`category_id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `categories`
--

LOCK TABLES `categories` WRITE;
/*!40000 ALTER TABLE `categories` DISABLE KEYS */;
INSERT INTO `categories` VALUES (10,'Fruit Chips','Light, crunchy fruit-forward snacks made for clean everyday munching and vibrant gifting.','https://pub-cc4c9eb64b96485987cd22bad726aee3.r2.dev/products/Apple-Pie-chips-Mockup-1.png'),(11,'Natural Sweeteners','Better-for-you sweetness crafted for modern kitchens, beverages, and mindful daily rituals.','https://pub-cc4c9eb64b96485987cd22bad726aee3.r2.dev/products/PIE-Monk-Fruit-Pouch-Mockup1.png');
/*!40000 ALTER TABLE `categories` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `coupon_usages`
--

DROP TABLE IF EXISTS `coupon_usages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `coupon_usages` (
  `coupon_usage_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `coupon_id` bigint unsigned NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `order_id` bigint unsigned NOT NULL,
  `code_snapshot` varchar(50) NOT NULL,
  `discount_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `redeemed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`coupon_usage_id`),
  UNIQUE KEY `uq_coupon_usage_order` (`order_id`),
  KEY `idx_coupon_usage_coupon_user` (`coupon_id`,`user_id`),
  CONSTRAINT `fk_coupon_usages_coupon` FOREIGN KEY (`coupon_id`) REFERENCES `coupons` (`coupon_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `coupon_usages`
--

LOCK TABLES `coupon_usages` WRITE;
/*!40000 ALTER TABLE `coupon_usages` DISABLE KEYS */;
/*!40000 ALTER TABLE `coupon_usages` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `coupons`
--

DROP TABLE IF EXISTS `coupons`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `coupons` (
  `coupon_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(50) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `discount_type` enum('PERCENT','FIXED') NOT NULL,
  `discount_value` decimal(10,2) NOT NULL,
  `max_discount_amount` decimal(10,2) DEFAULT NULL,
  `min_order_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `starts_at` datetime DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL,
  `usage_limit_total` int unsigned DEFAULT NULL,
  `usage_limit_per_user` int unsigned DEFAULT NULL,
  `used_count` int unsigned NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`coupon_id`),
  UNIQUE KEY `uq_coupons_code` (`code`),
  KEY `idx_coupons_active` (`is_active`,`starts_at`,`expires_at`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `coupons`
--

LOCK TABLES `coupons` WRITE;
/*!40000 ALTER TABLE `coupons` DISABLE KEYS */;
/*!40000 ALTER TABLE `coupons` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `order_items`
--

DROP TABLE IF EXISTS `order_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `order_items` (
  `order_item_id` int NOT NULL AUTO_INCREMENT,
  `order_id` int DEFAULT NULL,
  `product_id` int DEFAULT NULL,
  `quantity` int DEFAULT NULL,
  `price` decimal(10,2) DEFAULT NULL,
  PRIMARY KEY (`order_item_id`),
  KEY `order_id` (`order_id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `order_items_ibfk_1` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`),
  CONSTRAINT `order_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `order_items`
--

LOCK TABLES `order_items` WRITE;
/*!40000 ALTER TABLE `order_items` DISABLE KEYS */;
/*!40000 ALTER TABLE `order_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `orders`
--

DROP TABLE IF EXISTS `orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `orders` (
  `order_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `order_date` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `status` enum('PENDING_PAYMENT','PAID','pending','processing','shipped','delivered','cancelled') DEFAULT 'PENDING_PAYMENT',
  `total_amount` decimal(10,2) DEFAULT NULL,
  `shipping_id` varchar(64) DEFAULT NULL,
  `coupon_id` bigint unsigned DEFAULT NULL,
  `coupon_code` varchar(50) DEFAULT NULL,
  `subtotal_amount` decimal(10,2) DEFAULT NULL,
  `coupon_discount_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `final_amount` decimal(10,2) DEFAULT NULL,
  `provider_order_id` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`order_id`),
  KEY `user_id` (`user_id`),
  KEY `shipping_id` (`shipping_id`),
  KEY `fk_orders_coupon` (`coupon_id`),
  KEY `idx_orders_provider_order_id` (`provider_order_id`),
  CONSTRAINT `fk_orders_coupon` FOREIGN KEY (`coupon_id`) REFERENCES `coupons` (`coupon_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `orders_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `orders_ibfk_2` FOREIGN KEY (`shipping_id`) REFERENCES `shipping_info` (`shipping_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `orders`
--

LOCK TABLES `orders` WRITE;
/*!40000 ALTER TABLE `orders` DISABLE KEYS */;
/*!40000 ALTER TABLE `orders` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `payment_webhook_events`
--

DROP TABLE IF EXISTS `payment_webhook_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payment_webhook_events` (
  `event_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `provider` varchar(30) NOT NULL DEFAULT 'RAZORPAY',
  `event_id_ext` varchar(100) DEFAULT NULL,
  `payload` json NOT NULL,
  `received_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_id`),
  KEY `idx_webhook_provider_event` (`provider`,`event_id_ext`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `payment_webhook_events`
--

LOCK TABLES `payment_webhook_events` WRITE;
/*!40000 ALTER TABLE `payment_webhook_events` DISABLE KEYS */;
/*!40000 ALTER TABLE `payment_webhook_events` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `payments`
--

DROP TABLE IF EXISTS `payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payments` (
  `payment_id` int NOT NULL AUTO_INCREMENT,
  `order_id` int DEFAULT NULL,
  `payment_date` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `amount` bigint NOT NULL DEFAULT '0',
  `currency` varchar(10) NOT NULL DEFAULT 'INR',
  `provider` varchar(30) NOT NULL DEFAULT 'RAZORPAY',
  `provider_order_id` varchar(100) DEFAULT NULL,
  `provider_payment_id` varchar(100) DEFAULT NULL,
  `provider_signature` varchar(255) DEFAULT NULL,
  `status` enum('PENDING','SUCCESS','FAILED','REFUNDED') NOT NULL DEFAULT 'PENDING',
  `idempotency_key` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`payment_id`),
  UNIQUE KEY `uq_payments_idempotency` (`idempotency_key`),
  UNIQUE KEY `uq_payments_provider_payment_id` (`provider_payment_id`),
  KEY `order_id` (`order_id`),
  CONSTRAINT `payments_ibfk_1` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `payments`
--

LOCK TABLES `payments` WRITE;
/*!40000 ALTER TABLE `payments` DISABLE KEYS */;
/*!40000 ALTER TABLE `payments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `product_categories`
--

DROP TABLE IF EXISTS `product_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `product_categories` (
  `product_id` int NOT NULL,
  `category_id` int NOT NULL,
  PRIMARY KEY (`product_id`,`category_id`),
  KEY `category_id` (`category_id`),
  CONSTRAINT `product_categories_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`),
  CONSTRAINT `product_categories_ibfk_2` FOREIGN KEY (`category_id`) REFERENCES `categories` (`category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `product_categories`
--

LOCK TABLES `product_categories` WRITE;
/*!40000 ALTER TABLE `product_categories` DISABLE KEYS */;
INSERT INTO `product_categories` VALUES (33,10),(34,10),(35,10),(36,10),(37,10),(38,10),(39,10),(40,10),(41,11);
/*!40000 ALTER TABLE `product_categories` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `products`
--

DROP TABLE IF EXISTS `products`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `products` (
  `product_id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) DEFAULT NULL,
  `sub_name` text,
  `description` text,
  `price` decimal(10,2) DEFAULT NULL,
  `stock_quantity` int DEFAULT NULL,
  `image_url` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `category_id` int DEFAULT NULL,
  `specifications` text,
  `details` text,
  `image_url1` varchar(255) DEFAULT NULL,
  `image_url2` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`product_id`),
  KEY `category_id_idx` (`category_id`),
  CONSTRAINT `category_id` FOREIGN KEY (`category_id`) REFERENCES `categories` (`category_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=42 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `products`
--

LOCK TABLES `products` WRITE;
/*!40000 ALTER TABLE `products` DISABLE KEYS */;
INSERT INTO `products` VALUES (33,'Apple Pie Chips','Crisp orchard apple bites with a naturally bright finish.','PIE Apple Pie Chips are made for clean snacking moments when you want fruit-led crunch without the heaviness of fried junk food. The profile is crisp, familiar, and gently sweet, making it an easy everyday pick for school boxes, office breaks, and travel packs.',249.00,120,'https://pub-cc4c9eb64b96485987cd22bad726aee3.r2.dev/products/Apple-Pie-chips-Mockup-1.png','2026-04-18 10:18:29',10,'Format: Ready-to-eat fruit chips. Texture: Light and crunchy. Best for: Midday snacking, lunch boxes, gifting hampers.','Serve straight from the pack, add to yogurt bowls, or use as a topping over oats and smoothie bowls for extra crunch.','https://pub-cc4c9eb64b96485987cd22bad726aee3.r2.dev/products/Apple-Pie-chips-Mockup-2.png',NULL),(34,'Banana Pie Chips','Golden banana crunch with a mellow, comforting sweetness.','PIE Banana Pie Chips bring together a familiar fruit taste and a satisfying snap that works for all age groups. They are ideal when you want a simple, approachable snack that feels fruity, portable, and easy to enjoy on repeat.',229.00,140,'https://pub-cc4c9eb64b96485987cd22bad726aee3.r2.dev/products/Banana-Pie-chips-Mockup-1.png','2026-04-18 10:18:29',10,'Format: Ready-to-eat fruit chips. Texture: Crisp and snackable. Best for: Family snack jars, tea-time bites, road trips.','Pair with nut butter, granola, or trail mix for a fuller snack plate with texture and natural sweetness.','https://pub-cc4c9eb64b96485987cd22bad726aee3.r2.dev/products/Banana-Pie-chips-Mockup-2.png',NULL),(35,'Chikoo Pie Chips','A rich chikoo-inspired crunch with warm dessert-like notes.','PIE Chikoo Pie Chips are built for people who enjoy a deeper, rounded fruit profile. The flavor feels slightly more indulgent than classic chips, which makes it a strong choice for premium gifting, curated snack platters, and moments when you want something a little different.',259.00,90,'https://pub-cc4c9eb64b96485987cd22bad726aee3.r2.dev/products/chikoo-Pie-chips-Mockup-1.png','2026-04-18 10:18:29',10,'Format: Ready-to-eat fruit chips. Texture: Crisp with a rich fruit profile. Best for: Premium snacking, gifting, party platters.','Enjoy alongside coffee, masala chai, or as a crunchy topper over vanilla yogurt and dessert bowls.','https://pub-cc4c9eb64b96485987cd22bad726aee3.r2.dev/products/chikoo-Pie-chips-Mockup-2.png',NULL),(36,'Jackfruit Pie Chips','Bold tropical crunch with a fuller fruit character.','PIE Jackfruit Pie Chips lean into a bolder tropical profile and are perfect for shoppers looking beyond standard snack flavors. They feel vibrant, memorable, and conversation-starting while still staying rooted in a familiar crunchy format.',269.00,80,'https://pub-cc4c9eb64b96485987cd22bad726aee3.r2.dev/products/Jack-fruit-Pie-chips-Mockup-1.png','2026-04-18 10:18:29',10,'Format: Ready-to-eat fruit chips. Texture: Crisp and tropical. Best for: Novelty snacking, gourmet hampers, sharing bowls.','Use as a tropical topping over smoothie bowls or snack on them as-is when you want something more distinctive.','https://pub-cc4c9eb64b96485987cd22bad726aee3.r2.dev/products/Jack-fruit-Pie-chips-Mockup-2.png',NULL),(37,'Jamun Pie Chips','Dark fruit personality with a crisp, modern snack finish.','PIE Jamun Pie Chips stand out with a characterful fruit profile that feels premium and less ordinary than typical packaged snacks. They are a strong option for a curated catalog because they add visual variety and a distinct flavor identity to the lineup.',279.00,75,'https://pub-cc4c9eb64b96485987cd22bad726aee3.r2.dev/products/Jamun-Pie-chips-Mockup-1.png','2026-04-18 10:18:29',10,'Format: Ready-to-eat fruit chips. Texture: Crisp and premium. Best for: Signature snack boxes, curated collections, festive gifting.','Pair with cheese boards, mocktails, or dessert platters for a stylish serving option with strong visual appeal.','https://pub-cc4c9eb64b96485987cd22bad726aee3.r2.dev/products/Jamun-Pie-chips-Mockup-2.png',NULL),(38,'Mango Pie Chips','Sunny mango crunch made for instant crowd appeal.','PIE Mango Pie Chips are the easiest hero product in the lineup because the flavor is familiar, upbeat, and broadly loved. They work well as a featured catalog item, a gift-box inclusion, and a reliable first purchase for new customers.',249.00,160,'https://pub-cc4c9eb64b96485987cd22bad726aee3.r2.dev/products/mango-Pie-chips-Mockup-1.png','2026-04-18 10:18:29',10,'Format: Ready-to-eat fruit chips. Texture: Crisp and fruity. Best for: Bestseller placement, combo boxes, family snacking.','Serve chilled for a refreshing twist or crush lightly over yogurt and ice cream to add texture and fruit notes.','https://pub-cc4c9eb64b96485987cd22bad726aee3.r2.dev/products/mango-Pie-chips-Mockup-2.png',NULL),(39,'Pineapple Pie Chips','Bright tropical crunch with a lively island-style profile.','PIE Pineapple Pie Chips bring a fresh, upbeat feeling to the range and help the catalog look more colorful and summery. The profile is ideal for shoppers who want a tropical note in a crisp, grab-and-go snack format.',239.00,110,'https://pub-cc4c9eb64b96485987cd22bad726aee3.r2.dev/products/pineapple-Pie-chips-Mockup-1.png','2026-04-18 10:18:29',10,'Format: Ready-to-eat fruit chips. Texture: Crisp and zesty. Best for: Summer gifting, travel packs, everyday snacking.','Try them with sparkling drinks, fruit bowls, or as a crunchy garnish on chilled desserts and parfaits.','https://pub-cc4c9eb64b96485987cd22bad726aee3.r2.dev/products/pineapple-Pie-chips-Mockup-2.png',NULL),(40,'Strawberry Pie Chips','Berry-bright crunch that feels playful and premium at once.','PIE Strawberry Pie Chips add a more playful berry note to the catalog while still looking premium and polished. They are a natural fit for gift boxes, combo packs, and customers drawn to a softer fruit aesthetic.',279.00,95,'https://pub-cc4c9eb64b96485987cd22bad726aee3.r2.dev/products/Strawberry-Pie-chips-Mockup-1.png','2026-04-18 10:18:29',10,'Format: Ready-to-eat fruit chips. Texture: Light and berry-forward. Best for: Gift hampers, dessert pairings, premium snack curation.','Use over pancakes, cereal, smoothie bowls, or enjoy directly from the pack when you want a fruit-led crunch.','https://pub-cc4c9eb64b96485987cd22bad726aee3.r2.dev/products/Strawberry-Pie-chips-Mockup-2.png',NULL),(41,'Monk Fruit Sweetener','Clean everyday sweetness for beverages, desserts, and mindful recipes.','PIE Monk Fruit Sweetener is positioned as a clean, modern pantry staple for people who want everyday sweetness without relying on conventional sugar-heavy habits. It fits coffee, tea, shakes, desserts, and home recipes where a smarter sweetening option matters.',349.00,130,'https://pub-cc4c9eb64b96485987cd22bad726aee3.r2.dev/products/PIE-Monk-Fruit-Pouch-Mockup1.png','2026-04-18 10:18:29',11,'Format: Pantry sweetener. Usage: Drinks, desserts, daily cooking. Best for: Coffee, tea, smoothies, low-sugar recipes.','Use in tea, coffee, lemonade, yogurt, baking mixes, and light dessert recipes whenever you want a cleaner sweetening option.','https://pub-cc4c9eb64b96485987cd22bad726aee3.r2.dev/products/PIE-Monk-Fruit-Pouch-Mockup-2.png','https://pub-cc4c9eb64b96485987cd22bad726aee3.r2.dev/products/Pie-monk-fruit-Sachet-mockup-1.png');
/*!40000 ALTER TABLE `products` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `reviews`
--

DROP TABLE IF EXISTS `reviews`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reviews` (
  `review_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `product_id` int DEFAULT NULL,
  `rating` int DEFAULT NULL,
  `comment` text,
  `review_date` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`review_id`),
  KEY `user_id` (`user_id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `reviews_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `reviews_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`),
  CONSTRAINT `reviews_chk_1` CHECK ((`rating` between 1 and 5))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `reviews`
--

LOCK TABLES `reviews` WRITE;
/*!40000 ALTER TABLE `reviews` DISABLE KEYS */;
/*!40000 ALTER TABLE `reviews` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `shipping_info`
--

DROP TABLE IF EXISTS `shipping_info`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `shipping_info` (
  `shipping_id` varchar(64) NOT NULL,
  `user_id` int DEFAULT NULL,
  `address` text,
  `city` varchar(100) DEFAULT NULL,
  `state` varchar(100) DEFAULT NULL,
  `postal_code` varchar(20) DEFAULT NULL,
  `country` varchar(100) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`shipping_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `shipping_info_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `shipping_info`
--

LOCK TABLES `shipping_info` WRITE;
/*!40000 ALTER TABLE `shipping_info` DISABLE KEYS */;
/*!40000 ALTER TABLE `shipping_info` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `user_id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `password_hash` varchar(255) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `address` text,
  `role` enum('customer','admin') DEFAULT 'customer',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-04-18 16:18:23

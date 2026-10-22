-- ═══════════════════════════════════════════════════════════════
--  0002 — قايمة الأسعار والحلاقين
--
--  الخدمة والحلاق ما بيتمسحوش أبدًا: الأدوار القديمة بتشاور عليهم.
--  «المسح» = أرشفة (archived_at)، والدور نفسه شايل نسخة من الاسم
--  والسعر والمدّة وقت أخده، فتعديل السعر النهارده ما يغيّرش حساب امبارح.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE services (
  id               BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  shop_id          BIGINT UNSIGNED   NOT NULL,
  name             VARCHAR(80)       NOT NULL,
  price            BIGINT UNSIGNED   NOT NULL COMMENT 'بالقروش',
  -- المدّة المبدئية لحد ما السيستم يتعلّم مدّة كل حلاق (barber_service_stats)
  default_minutes  SMALLINT UNSIGNED NOT NULL,
  active           TINYINT(1)        NOT NULL DEFAULT 1,
  sort_order       INT               NOT NULL DEFAULT 0,
  archived_at      TIMESTAMP         NULL,
  created_at       TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_services_shop (shop_id, archived_at, sort_order),
  CONSTRAINT fk_services_shop FOREIGN KEY (shop_id) REFERENCES shops (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE barbers (
  id                BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  shop_id           BIGINT UNSIGNED   NOT NULL,
  name              VARCHAR(60)       NOT NULL,
  chair_no          SMALLINT UNSIGNED NULL,
  -- off = مش موجود النهارده (مش داخل في حساب الوقت المتوقّع)
  status            ENUM('available','break','off') NOT NULL DEFAULT 'off',
  break_until       TIMESTAMP         NULL,
  -- PIN من 4 أرقام لتابلت الكرسي (bcrypt)، ويتقفل بعد محاولات فاشلة
  pin_hash          VARCHAR(100)      NULL,
  failed_pins       TINYINT UNSIGNED  NOT NULL DEFAULT 0,
  pin_locked_until  TIMESTAMP         NULL,
  photo_path        VARCHAR(255)      NULL,
  sort_order        INT               NOT NULL DEFAULT 0,
  archived_at       TIMESTAMP         NULL,
  created_at        TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_barbers_shop (shop_id, archived_at, sort_order),
  CONSTRAINT fk_barbers_shop FOREIGN KEY (shop_id) REFERENCES shops (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

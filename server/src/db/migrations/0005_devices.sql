-- ═══════════════════════════════════════════════════════════════
--  0005 — أجهزة المحل: شاشة التلفزيون، وتابلت الباب، وتابلت الكرسي
--
--  الجهاز ما بيدخلش بحساب شخص. المالك بيطلّع كود ربط من 6 أرقام (صالح
--  10 دقايق، مرّة واحدة)، والجهاز بيدخّله فياخد توكن طويل بنخزّن بصمته بس.
--  المالك يقدر يلغي أي جهاز في أي وقت.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE devices (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shop_id            BIGINT UNSIGNED NOT NULL,
  type               ENUM('display','kiosk','chair') NOT NULL,
  name               VARCHAR(60)     NOT NULL,
  token_hash         CHAR(64)        NOT NULL,
  -- تابلت الكرسي: الحلاق اللي داخل عليه دلوقتي بالـ PIN
  current_barber_id  BIGINT UNSIGNED NULL,
  last_seen_at       TIMESTAMP       NULL,
  revoked_at         TIMESTAMP       NULL,
  created_by         BIGINT UNSIGNED NULL,
  created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_devices_token (token_hash),
  KEY ix_devices_shop (shop_id, revoked_at),
  KEY ix_devices_barber (current_barber_id),
  CONSTRAINT fk_devices_shop FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE,
  CONSTRAINT fk_devices_barber FOREIGN KEY (current_barber_id) REFERENCES barbers (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE device_pairings (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shop_id     BIGINT UNSIGNED NOT NULL,
  type        ENUM('display','kiosk','chair') NOT NULL,
  name        VARCHAR(60)     NOT NULL,
  code_hash   CHAR(64)        NOT NULL,
  expires_at  TIMESTAMP       NOT NULL,
  used_at     TIMESTAMP       NULL,
  device_id   BIGINT UNSIGNED NULL,
  created_by  BIGINT UNSIGNED NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_pairings_code (code_hash, used_at, expires_at),
  CONSTRAINT fk_pairings_shop FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════════
--  0004 — حسابات الزباين: الجلسات، واستعادة كلمة السر، وإشعارات الموبايل
--
--  الدخول برقم الموبايل وكلمة سر (من غير SMS). البريد اختياري، ولو الزبون
--  حطّه بيبقى طريقة استعادة كلمة السر.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE customers
  ADD COLUMN email VARCHAR(190) NULL AFTER name,
  ADD UNIQUE KEY uq_customers_email (email);

-- نفس فكرة توكنات الموظفين: البصمة بس، وسلسلة تدوير تتلغي كلها لو توكن قديم اتعاد
CREATE TABLE customer_refresh_tokens (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id  BIGINT UNSIGNED NOT NULL,
  family_id    CHAR(36)        NOT NULL,
  token_hash   CHAR(64)        NOT NULL,
  client_type  ENUM('web','mobile','desktop') NOT NULL DEFAULT 'web',
  user_agent   VARCHAR(255)    NULL,
  ip_address   VARCHAR(45)     NULL,
  expires_at   TIMESTAMP       NOT NULL,
  used_at      TIMESTAMP       NULL,
  revoked_at   TIMESTAMP       NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_crefresh_hash (token_hash),
  KEY ix_crefresh_customer (customer_id, revoked_at),
  KEY ix_crefresh_family (family_id),
  CONSTRAINT fk_crefresh_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customer_password_resets (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id  BIGINT UNSIGNED NOT NULL,
  token_hash   CHAR(64)        NOT NULL,
  expires_at   TIMESTAMP       NOT NULL,
  used_at      TIMESTAMP       NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cpr_hash (token_hash),
  KEY ix_cpr_customer (customer_id),
  CONSTRAINT fk_cpr_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- اشتراكات Web Push لأجهزة الزبون (الموظفين ما بيستقبلوش push في المرحلة الأولى)
CREATE TABLE push_subscriptions (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id    BIGINT UNSIGNED NOT NULL,
  endpoint       VARCHAR(600)    NOT NULL,
  endpoint_hash  CHAR(64)        NOT NULL,
  p256dh         VARCHAR(255)    NOT NULL,
  auth           VARCHAR(255)    NOT NULL,
  user_agent     VARCHAR(255)    NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_push_endpoint (endpoint_hash),
  KEY ix_push_customer (customer_id),
  CONSTRAINT fk_push_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

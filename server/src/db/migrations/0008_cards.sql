-- ═══════════════════════════════════════════════════════════════
--  0008 — كارت الزبون: الملاحظات، وصور القصّات، وكارت الأختام، والتذكير
--
--  الكارت لكل زبون في كل محل (`shop_customers`): مربوط بحساب التطبيق،
--  أو برقم الموبايل لزبون الشارع والكشك. لو زبون شارع نزّل التطبيق بعدين
--  بنفس الرقم، الكارت نفسه بيترَبط بحسابه (مفيش كارتين لنفس الشخص).
--  زبون من غير حساب ولا موبايل مالوش كارت.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE shop_customers (
  id                BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  shop_id           BIGINT UNSIGNED   NOT NULL,
  customer_id       BIGINT UNSIGNED   NULL,
  phone             VARCHAR(30)       NULL,
  name              VARCHAR(60)       NOT NULL,
  -- «درجة 2 على الجناب، ما بيحبش الجِل» — للموظفين والحلاق بس
  notes             VARCHAR(1000)     NULL,
  stamps            SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  rewards_redeemed  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  visits            INT UNSIGNED      NOT NULL DEFAULT 0,
  total_spent       BIGINT UNSIGNED   NOT NULL DEFAULT 0 COMMENT 'بالقروش',
  first_visit_at    TIMESTAMP         NULL,
  last_visit_at     TIMESTAMP         NULL,
  last_barber_id    BIGINT UNSIGNED   NULL,
  -- آخر تذكير «بقالك 3 أسابيع» (مرّة واحدة لكل زيارة)
  reminded_at       TIMESTAMP         NULL,
  reminders_off     TINYINT(1)        NOT NULL DEFAULT 0,
  created_at        TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cards_customer (shop_id, customer_id),
  UNIQUE KEY uq_cards_phone (shop_id, phone),
  KEY ix_cards_last_visit (shop_id, last_visit_at),
  KEY ix_cards_name (shop_id, name),
  CONSTRAINT fk_cards_shop FOREIGN KEY (shop_id) REFERENCES shops (id),
  CONSTRAINT fk_cards_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_cards_barber FOREIGN KEY (last_barber_id) REFERENCES barbers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- صور القصّات: الملف نفسه على السيرفر (UPLOADS_DIR)، مش في مكان عام
CREATE TABLE customer_photos (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shop_id           BIGINT UNSIGNED NOT NULL,
  shop_customer_id  BIGINT UNSIGNED NOT NULL,
  ticket_id         BIGINT UNSIGNED NULL,
  barber_id         BIGINT UNSIGNED NULL,
  file_name         VARCHAR(80)     NOT NULL,
  mime              VARCHAR(30)     NOT NULL,
  bytes             INT UNSIGNED    NOT NULL,
  taken_by          ENUM('staff','chair') NOT NULL,
  taken_by_id       BIGINT UNSIGNED NULL,
  created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at        TIMESTAMP       NULL,
  deleted_by        ENUM('staff','customer') NULL,
  PRIMARY KEY (id),
  KEY ix_photos_card (shop_customer_id, deleted_at, id),
  KEY ix_photos_ticket (ticket_id),
  CONSTRAINT fk_photos_shop FOREIGN KEY (shop_id) REFERENCES shops (id),
  CONSTRAINT fk_photos_card FOREIGN KEY (shop_customer_id) REFERENCES shop_customers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- كل ختم اتحط أو اتصرف أو اتعدّل، بسببه
CREATE TABLE loyalty_events (
  id                BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  shop_id           BIGINT UNSIGNED   NOT NULL,
  shop_customer_id  BIGINT UNSIGNED   NOT NULL,
  bill_id           BIGINT UNSIGNED   NULL,
  type              ENUM('earn','redeem','adjust','merge') NOT NULL,
  delta             SMALLINT          NOT NULL,
  stamps_after      SMALLINT UNSIGNED NOT NULL,
  note              VARCHAR(190)      NULL,
  created_by        BIGINT UNSIGNED   NULL,
  created_at        TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_loyalty_card (shop_customer_id, id),
  KEY ix_loyalty_bill (bill_id),
  CONSTRAINT fk_loyalty_card FOREIGN KEY (shop_customer_id) REFERENCES shop_customers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE queue_tickets
  ADD COLUMN shop_customer_id BIGINT UNSIGNED NULL AFTER customer_id,
  ADD KEY ix_ticket_card (shop_customer_id, status),
  ADD CONSTRAINT fk_ticket_card FOREIGN KEY (shop_customer_id) REFERENCES shop_customers (id);

ALTER TABLE shop_settings
  -- كارت الأختام: ختم لكل زيارة مدفوعة، وبعد العدد ده الزيارة الجاية مكافأة
  ADD COLUMN loyalty_enabled            TINYINT(1)        NOT NULL DEFAULT 0,
  ADD COLUMN loyalty_stamps_required    TINYINT UNSIGNED  NOT NULL DEFAULT 9,
  -- service = خدمة معيّنة ببلاش · top_service = أغلى خدمة في الفاتورة · amount = مبلغ · percent = نسبة
  ADD COLUMN loyalty_reward_type        ENUM('service','top_service','amount','percent') NOT NULL DEFAULT 'top_service',
  ADD COLUMN loyalty_reward_service_id  BIGINT UNSIGNED   NULL,
  ADD COLUMN loyalty_reward_value       INT UNSIGNED      NOT NULL DEFAULT 0 COMMENT 'قروش للمبلغ، أو 1-100 للنسبة',
  ADD COLUMN loyalty_min_total          BIGINT UNSIGNED   NOT NULL DEFAULT 0 COMMENT 'أقل إجمالي فاتورة للختم، بالقروش',
  -- تذكير «بقالك 3 أسابيع»
  ADD COLUMN reminder_enabled           TINYINT(1)        NOT NULL DEFAULT 0,
  ADD COLUMN reminder_days              SMALLINT UNSIGNED NOT NULL DEFAULT 21;

-- ── نقل بيانات المرحلة الأولى ──────────────────────────────────
-- 1) زباين التطبيق: كارت لكل (محل، حساب) من الأدوار القديمة
INSERT INTO shop_customers (shop_id, customer_id, phone, name, visits, first_visit_at, last_visit_at)
SELECT t.shop_id, t.customer_id, c.phone, c.name,
       SUM(t.status = 'done'), MIN(CASE WHEN t.status = 'done' THEN t.finished_at END),
       MAX(CASE WHEN t.status = 'done' THEN t.finished_at END)
  FROM queue_tickets t JOIN customers c ON c.id = t.customer_id
 WHERE t.customer_id IS NOT NULL
 GROUP BY t.shop_id, t.customer_id, c.phone, c.name;

-- 2) زباين الشارع والكشك اللي كتبوا موبايل (لو الرقم ما اتربطش بحساب فوق)
INSERT IGNORE INTO shop_customers (shop_id, phone, name, visits, first_visit_at, last_visit_at)
SELECT t.shop_id, t.phone,
       SUBSTRING_INDEX(GROUP_CONCAT(t.name ORDER BY t.id DESC SEPARATOR '\n'), '\n', 1),
       SUM(t.status = 'done'), MIN(CASE WHEN t.status = 'done' THEN t.finished_at END),
       MAX(CASE WHEN t.status = 'done' THEN t.finished_at END)
  FROM queue_tickets t
 WHERE t.customer_id IS NULL AND t.phone IS NOT NULL AND t.phone <> ''
 GROUP BY t.shop_id, t.phone;

UPDATE queue_tickets t JOIN shop_customers sc ON sc.shop_id = t.shop_id AND sc.customer_id = t.customer_id
   SET t.shop_customer_id = sc.id
 WHERE t.customer_id IS NOT NULL;

UPDATE queue_tickets t JOIN shop_customers sc ON sc.shop_id = t.shop_id AND sc.phone = t.phone
   SET t.shop_customer_id = sc.id
 WHERE t.customer_id IS NULL AND t.phone IS NOT NULL AND t.shop_customer_id IS NULL;

UPDATE shop_customers sc
   SET sc.last_barber_id = (
     SELECT t.barber_id FROM queue_tickets t
      WHERE t.shop_customer_id = sc.id AND t.status = 'done' AND t.barber_id IS NOT NULL
      ORDER BY t.finished_at DESC, t.id DESC LIMIT 1
   );

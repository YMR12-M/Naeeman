-- ═══════════════════════════════════════════════════════════════
--  0009 — الكاشير: الفواتير، والدفع، والدرج، وتقفيل اليوم
--
--  الفاتورة هي مصدر الحقيقة للفلوس (الدور بيقول مين اتحلق وإمتى).
--  لو الكاشير مقفول في الإعدادات (زي المرحلة الأولى)، الدور لما يخلص
--  بيعمل فاتورة ويتسدّد كاش أوتوماتيك، فالتقارير بتقرا من مكان واحد.
--
--  مفيش مسح للفلوس: الفاتورة المفتوحة بتتلغي بسبب، والمدفوعة بترجّع
--  فلوس بدفعة بالسالب (kind = refund).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE shop_settings
  -- مقفول = الدور اللي خلص بيتسدّد كاش لوحده (من غير كاشير ولا درج)
  ADD COLUMN cashier_enabled           TINYINT(1)       NOT NULL DEFAULT 0,
  -- أقصى خصم للاستقبال (نسبة من الفاتورة). المدير والمالك من غير حد.
  ADD COLUMN max_cashier_discount_pct  TINYINT UNSIGNED NOT NULL DEFAULT 10,
  ADD COLUMN receipt_width             ENUM('58','80')  NOT NULL DEFAULT '80',
  ADD COLUMN receipt_footer            VARCHAR(190)     NULL,
  ADD COLUMN receipt_auto_print        TINYINT(1)       NOT NULL DEFAULT 0;

-- طرق الدفع لكل محل (بتتعمل لوحدها أوّل مرّة: كاش، فيزا، محفظة، إنستاباي)
CREATE TABLE payment_methods (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shop_id     BIGINT UNSIGNED NOT NULL,
  code        VARCHAR(24)     NOT NULL,
  label       VARCHAR(40)     NOT NULL,
  -- cash بس هي اللي بتدخل الدرج
  kind        ENUM('cash','card','wallet','transfer','other') NOT NULL,
  active      TINYINT(1)      NOT NULL DEFAULT 1,
  sort_order  INT             NOT NULL DEFAULT 0,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_methods_code (shop_id, code),
  CONSTRAINT fk_methods_shop FOREIGN KEY (shop_id) REFERENCES shops (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- تقفيل اليوم (Z): بيقفل الفترة من آخر تقفيل لحد دلوقتي، ويحفظ ملخّص ثابت
CREATE TABLE day_closes (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shop_id        BIGINT UNSIGNED NOT NULL,
  number         INT UNSIGNED    NOT NULL COMMENT 'رقم التقفيل المتسلسل في المحل',
  business_date  DATE            NOT NULL,
  period_start   TIMESTAMP       NULL,
  period_end     TIMESTAMP       NOT NULL,
  summary        JSON            NOT NULL,
  note           VARCHAR(190)    NULL,
  closed_by      BIGINT UNSIGNED NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_closes_number (shop_id, number),
  KEY ix_closes_date (shop_id, business_date),
  CONSTRAINT fk_closes_shop FOREIGN KEY (shop_id) REFERENCES shops (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- الدرج (الوردية): درج واحد مفتوح في المحل في نفس الوقت (open_guard فريد)
CREATE TABLE drawer_sessions (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shop_id        BIGINT UNSIGNED NOT NULL,
  business_date  DATE            NOT NULL,
  status         ENUM('open','closed') NOT NULL DEFAULT 'open',
  open_guard     TINYINT GENERATED ALWAYS AS (CASE WHEN status = 'open' THEN 1 END) STORED,
  opening_float  BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'الفكّة أوّل الوردية، بالقروش',
  opened_by      BIGINT UNSIGNED NULL,
  opened_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expected_cash  BIGINT          NULL,
  counted_cash   BIGINT UNSIGNED NULL,
  variance       BIGINT          NULL COMMENT 'المعدود − المتوقّع (سالب = عجز)',
  closed_by      BIGINT UNSIGNED NULL,
  closed_at      TIMESTAMP       NULL,
  note           VARCHAR(190)    NULL,
  day_close_id   BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_drawer_open (shop_id, open_guard),
  KEY ix_drawer_shop (shop_id, opened_at),
  KEY ix_drawer_close (day_close_id),
  CONSTRAINT fk_drawer_shop FOREIGN KEY (shop_id) REFERENCES shops (id),
  CONSTRAINT fk_drawer_dayclose FOREIGN KEY (day_close_id) REFERENCES day_closes (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bills (
  id                BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  shop_id           BIGINT UNSIGNED  NOT NULL,
  business_date     DATE             NOT NULL,
  -- رقم الفاتورة: بيبدأ من 1 كل يوم شغل
  number            INT UNSIGNED     NOT NULL,
  source            ENUM('ticket','counter') NOT NULL,
  ticket_id         BIGINT UNSIGNED  NULL,
  shop_customer_id  BIGINT UNSIGNED  NULL,
  customer_name     VARCHAR(60)      NULL,
  customer_phone    VARCHAR(30)      NULL,
  -- الحلاق اللي اشتغل على الدور (البقشيش ليه)
  barber_id         BIGINT UNSIGNED  NULL,
  status            ENUM('open','paid','void') NOT NULL DEFAULT 'open',
  subtotal          BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  discount          BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  discount_reason   VARCHAR(190)     NULL,
  -- مكافأة كارت الأختام (على حساب المحل)
  reward_discount   BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  total             BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'subtotal − discount − reward_discount',
  tip               BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  -- اللي اتحصّل فعلًا = total + tip، والباقي اللي اترجع للزبون من الكاش
  paid              BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  change_given      BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  refunded          BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  stamp_awarded     TINYINT(1)       NOT NULL DEFAULT 0,
  reward_redeemed   TINYINT(1)       NOT NULL DEFAULT 0,
  -- اتسدّدت كاش لوحدها (الكاشير مقفول)
  auto_paid         TINYINT(1)       NOT NULL DEFAULT 0,
  paid_date         DATE             NULL,
  paid_at           TIMESTAMP        NULL,
  paid_by           BIGINT UNSIGNED  NULL,
  voided_at         TIMESTAMP        NULL,
  voided_by         BIGINT UNSIGNED  NULL,
  void_reason       VARCHAR(190)     NULL,
  created_by        BIGINT UNSIGNED  NULL,
  -- التقفيل اللي الفاتورة المدفوعة اتحسبت فيه
  day_close_id      BIGINT UNSIGNED  NULL,
  created_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bills_number (shop_id, business_date, number),
  KEY ix_bills_close (shop_id, day_close_id),
  UNIQUE KEY uq_bills_ticket (ticket_id),
  KEY ix_bills_status (shop_id, status, created_at),
  KEY ix_bills_paid (shop_id, paid_date),
  KEY ix_bills_card (shop_customer_id),
  CONSTRAINT fk_bills_shop FOREIGN KEY (shop_id) REFERENCES shops (id),
  CONSTRAINT fk_bills_ticket FOREIGN KEY (ticket_id) REFERENCES queue_tickets (id),
  CONSTRAINT fk_bills_card FOREIGN KEY (shop_customer_id) REFERENCES shop_customers (id),
  CONSTRAINT fk_bills_barber FOREIGN KEY (barber_id) REFERENCES barbers (id),
  CONSTRAINT fk_bills_dayclose FOREIGN KEY (day_close_id) REFERENCES day_closes (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- سطور الفاتورة: نسخة من الاسم والسعر وقت الإضافة، والعمولة وقت الدفع
CREATE TABLE bill_items (
  id                 BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  bill_id            BIGINT UNSIGNED   NOT NULL,
  kind               ENUM('service','product') NOT NULL,
  service_id         BIGINT UNSIGNED   NULL,
  product_id         BIGINT UNSIGNED   NULL,
  ticket_service_id  BIGINT UNSIGNED   NULL,
  name               VARCHAR(80)       NOT NULL,
  unit_price         BIGINT UNSIGNED   NOT NULL,
  qty                SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  line_total         BIGINT UNSIGNED   NOT NULL,
  -- نصيب السطر من الخصم اليدوي ومن مكافأة الأختام (بيتوزّعوا وقت الدفع)
  discount_share     BIGINT UNSIGNED   NOT NULL DEFAULT 0,
  reward_share       BIGINT UNSIGNED   NOT NULL DEFAULT 0,
  barber_id          BIGINT UNSIGNED   NULL,
  unit_cost          BIGINT UNSIGNED   NULL COMMENT 'تكلفة المنتج وقت البيع',
  -- نسبة الحلاق (× 100) والعمولة نفسها، بتتسجّل وقت الدفع
  commission_rate    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  commission         BIGINT UNSIGNED   NOT NULL DEFAULT 0,
  settlement_id      BIGINT UNSIGNED   NULL,
  added_by           ENUM('ticket','staff') NOT NULL DEFAULT 'staff',
  created_at         TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_items_bill (bill_id),
  KEY ix_items_barber (barber_id, settlement_id),
  CONSTRAINT fk_items_bill FOREIGN KEY (bill_id) REFERENCES bills (id),
  CONSTRAINT fk_items_service FOREIGN KEY (service_id) REFERENCES services (id),
  CONSTRAINT fk_items_product FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT fk_items_barber FOREIGN KEY (barber_id) REFERENCES barbers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payments (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shop_id            BIGINT UNSIGNED NOT NULL,
  bill_id            BIGINT UNSIGNED NOT NULL,
  drawer_session_id  BIGINT UNSIGNED NULL,
  business_date      DATE            NOT NULL,
  kind               ENUM('payment','refund') NOT NULL DEFAULT 'payment',
  method_code        VARCHAR(24)     NOT NULL,
  method_label       VARCHAR(40)     NOT NULL,
  method_kind        ENUM('cash','card','wallet','transfer','other') NOT NULL,
  amount             BIGINT          NOT NULL COMMENT 'موجب = دخل، سالب = مرتجع',
  -- الكاش: الزبون ادّى كام (الباقي = tendered − amount)
  tendered           BIGINT UNSIGNED NULL,
  reference          VARCHAR(60)     NULL COMMENT 'رقم العملية أو آخر 4 أرقام',
  reason             VARCHAR(190)    NULL,
  created_by         BIGINT UNSIGNED NULL,
  day_close_id       BIGINT UNSIGNED NULL,
  created_at         TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_payments_bill (bill_id),
  KEY ix_payments_date (shop_id, business_date),
  KEY ix_payments_drawer (drawer_session_id),
  KEY ix_payments_close (shop_id, day_close_id),
  CONSTRAINT fk_payments_shop FOREIGN KEY (shop_id) REFERENCES shops (id),
  CONSTRAINT fk_payments_bill FOREIGN KEY (bill_id) REFERENCES bills (id),
  CONSTRAINT fk_payments_drawer FOREIGN KEY (drawer_session_id) REFERENCES drawer_sessions (id),
  CONSTRAINT fk_payments_dayclose FOREIGN KEY (day_close_id) REFERENCES day_closes (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- حركات الدرج غير البيع: مصروف، سلفة حلاق، صرف حساب حلاق، إيداع، سحب للخزنة
CREATE TABLE cash_movements (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shop_id            BIGINT UNSIGNED NOT NULL,
  drawer_session_id  BIGINT UNSIGNED NOT NULL,
  business_date      DATE            NOT NULL,
  type               ENUM('expense','advance','payout','cash_in','cash_out') NOT NULL,
  amount             BIGINT UNSIGNED NOT NULL,
  barber_id          BIGINT UNSIGNED NULL,
  note               VARCHAR(190)    NULL,
  settlement_id      BIGINT UNSIGNED NULL,
  created_by         BIGINT UNSIGNED NULL,
  day_close_id       BIGINT UNSIGNED NULL,
  created_at         TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_moves_drawer (drawer_session_id),
  KEY ix_moves_date (shop_id, business_date),
  KEY ix_moves_barber (barber_id, settlement_id),
  KEY ix_moves_close (shop_id, day_close_id),
  CONSTRAINT fk_moves_shop FOREIGN KEY (shop_id) REFERENCES shops (id),
  CONSTRAINT fk_moves_drawer FOREIGN KEY (drawer_session_id) REFERENCES drawer_sessions (id),
  CONSTRAINT fk_moves_barber FOREIGN KEY (barber_id) REFERENCES barbers (id),
  CONSTRAINT fk_moves_dayclose FOREIGN KEY (day_close_id) REFERENCES day_closes (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── نقل بيانات المرحلة الأولى ──────────────────────────────────
-- كل دور خلص كان بيتعتبر اتدفع كاش بإجمالي خدماته: نعمله فاتورة مسدّدة كاش
INSERT INTO payment_methods (shop_id, code, label, kind, sort_order)
SELECT s.id, m.code, m.label, m.kind, m.sort_order
  FROM shops s
  JOIN (SELECT 'cash' AS code, 'كاش' AS label, 'cash' AS kind, 1 AS sort_order
        UNION ALL SELECT 'card', 'فيزا', 'card', 2
        UNION ALL SELECT 'wallet', 'محفظة', 'wallet', 3
        UNION ALL SELECT 'instapay', 'إنستاباي', 'transfer', 4) m;

INSERT INTO bills (shop_id, business_date, number, source, ticket_id, shop_customer_id, customer_name, customer_phone,
                   barber_id, status, subtotal, total, paid, auto_paid, paid_date, paid_at, created_at)
SELECT t.shop_id, t.business_date,
       ROW_NUMBER() OVER (PARTITION BY t.shop_id, t.business_date ORDER BY t.finished_at, t.id),
       'ticket', t.id, t.shop_customer_id, t.name, t.phone, t.barber_id, 'paid', t.total, t.total, t.total, 1,
       t.business_date, COALESCE(t.finished_at, t.updated_at), COALESCE(t.finished_at, t.updated_at)
  FROM queue_tickets t
 WHERE t.status = 'done';

INSERT INTO bill_items (bill_id, kind, service_id, ticket_service_id, name, unit_price, qty, line_total, barber_id, added_by, created_at)
SELECT b.id, 'service', ts.service_id, ts.id, ts.name, ts.price, 1, ts.price, b.barber_id, 'ticket', ts.created_at
  FROM bills b JOIN ticket_services ts ON ts.ticket_id = b.ticket_id;

INSERT INTO payments (shop_id, bill_id, business_date, method_code, method_label, method_kind, amount, created_at)
SELECT b.shop_id, b.id, b.business_date, 'cash', 'كاش', 'cash', b.total, b.paid_at
  FROM bills b WHERE b.total > 0;

INSERT INTO counters (shop_id, name, value)
SELECT shop_id, CONCAT('bill:', business_date), MAX(number) FROM bills GROUP BY shop_id, business_date;

UPDATE shop_customers sc
   SET sc.total_spent = (SELECT COALESCE(SUM(b.total), 0) FROM bills b WHERE b.shop_customer_id = sc.id AND b.status = 'paid');

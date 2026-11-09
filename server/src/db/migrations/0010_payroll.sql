-- ═══════════════════════════════════════════════════════════════
--  0010 — حساب الحلاقين: النسبة، واليومية، وإيجار الكرسي، والسُلف
--
--  معادلة واحدة لكل الأنواع (النوع مجرّد قالب جاهز في الواجهة):
--    الصافي = اليومية × أيام الشغل + نسبة الخدمات + نسبة المنتجات
--             + البقشيش − الإيجار − السُلف
--
--  العمولة بتتسجّل على سطر الفاتورة وقت الدفع (bill_items.commission)،
--  و«الحساب» بيقفل كل اللي ما اتحسبش لحد تاريخ معيّن (settlement_id)،
--  فمفيش حاجة تتحسب مرّتين.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE barbers
  ADD COLUMN pay_type        ENUM('commission','salary','chair_rent') NOT NULL DEFAULT 'commission',
  ADD COLUMN service_pct     SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'النسبة × 100 (4000 = 40%)',
  ADD COLUMN product_pct     SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'النسبة × 100',
  ADD COLUMN daily_wage      BIGINT UNSIGNED   NOT NULL DEFAULT 0 COMMENT 'بالقروش',
  ADD COLUMN rent_amount     BIGINT UNSIGNED   NOT NULL DEFAULT 0 COMMENT 'إيجار الكرسي بالقروش',
  ADD COLUMN rent_period     ENUM('day','week','month') NOT NULL DEFAULT 'week',
  ADD COLUMN tips_to_barber  TINYINT(1)        NOT NULL DEFAULT 1;

-- أيام الشغل: اليوم اللي الحلاق اتعلّم فيه «موجود» أو اشتغل على دور
CREATE TABLE barber_days (
  barber_id      BIGINT UNSIGNED NOT NULL,
  business_date  DATE            NOT NULL,
  shop_id        BIGINT UNSIGNED NOT NULL,
  settlement_id  BIGINT UNSIGNED NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (barber_id, business_date),
  KEY ix_days_settlement (barber_id, settlement_id),
  CONSTRAINT fk_days_barber FOREIGN KEY (barber_id) REFERENCES barbers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE barber_settlements (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shop_id             BIGINT UNSIGNED NOT NULL,
  barber_id           BIGINT UNSIGNED NOT NULL,
  -- الفترة: من بعد آخر حساب (أو أوّل يوم شغل) لحد period_to
  period_from         DATE            NULL,
  period_to           DATE            NOT NULL,
  -- نسخة من طريقة الحساب وقتها
  pay_snapshot        JSON            NOT NULL,
  days_worked         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  services_total      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  products_total      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  service_commission  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  product_commission  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  wages               BIGINT UNSIGNED NOT NULL DEFAULT 0,
  tips                BIGINT UNSIGNED NOT NULL DEFAULT 0,
  rent                BIGINT UNSIGNED NOT NULL DEFAULT 0,
  advances            BIGINT UNSIGNED NOT NULL DEFAULT 0,
  net                 BIGINT          NOT NULL COMMENT 'موجب = للحلاق، سالب = على الحلاق',
  -- drawer = اتصرف/اتحصّل من الدرج · outside = برّه الدرج · none = الصافي صفر
  settled_via         ENUM('drawer','outside','none') NOT NULL,
  cash_movement_id    BIGINT UNSIGNED NULL,
  note                VARCHAR(190)    NULL,
  created_by          BIGINT UNSIGNED NULL,
  created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_settlements_barber (barber_id, period_to),
  CONSTRAINT fk_settlements_shop FOREIGN KEY (shop_id) REFERENCES shops (id),
  CONSTRAINT fk_settlements_barber FOREIGN KEY (barber_id) REFERENCES barbers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- البقشيش بيتحسب مع الحلاق مرّة واحدة
ALTER TABLE bills ADD COLUMN tip_settlement_id BIGINT UNSIGNED NULL AFTER tip;

-- أيام الشغل القديمة من الأدوار اللي اتعملت
INSERT IGNORE INTO barber_days (barber_id, business_date, shop_id)
SELECT barber_id, business_date, shop_id FROM queue_tickets
 WHERE barber_id IS NOT NULL AND started_at IS NOT NULL
 GROUP BY barber_id, business_date, shop_id;

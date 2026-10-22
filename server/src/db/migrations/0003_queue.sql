-- ═══════════════════════════════════════════════════════════════
--  0003 — الطابور: الزباين، والأدوار وخدماتها وتاريخها، والمدد المتعلّمة
--
--  الدور (ticket) بيعدّي بالحالات: waiting ← serving ← done، أو بيقف عند
--  cancelled / no_show. مصدر الحقيقة للانتقالات في queue/states.js.
-- ═══════════════════════════════════════════════════════════════

-- صفّ واحد لكل محل: القفل اللي بيرتّب كل تعديلات الطابور ورا بعض
-- (SELECT … FOR UPDATE)، ورقم نسخة بيزيد مع كل تغيير للشاشات.
CREATE TABLE shop_state (
  shop_id        BIGINT UNSIGNED NOT NULL,
  queue_version  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (shop_id),
  CONSTRAINT fk_state_shop FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO shop_state (shop_id) SELECT id FROM shops;

-- الزبون: حساب برقم الموبايل وكلمة سر (من غير SMS). حساب واحد لكل المحلات.
CREATE TABLE customers (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid            CHAR(36)        NOT NULL,
  phone           VARCHAR(30)     NOT NULL,
  name            VARCHAR(60)     NOT NULL,
  password_hash   VARCHAR(100)    NOT NULL,
  status          ENUM('active','blocked') NOT NULL DEFAULT 'active',
  failed_logins   INT UNSIGNED    NOT NULL DEFAULT 0,
  locked_until    TIMESTAMP       NULL,
  last_login_at   TIMESTAMP       NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customers_uuid (uuid),
  UNIQUE KEY uq_customers_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE queue_tickets (
  id                      BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  shop_id                 BIGINT UNSIGNED  NOT NULL,
  -- يوم الشغل (المحل اللي بيقفل 2 بالليل: دور الساعة 1 بالليل تبع امبارح)
  business_date           DATE             NOT NULL,
  -- رقم الدور اللي بيتنادى بيه: بيبدأ من 1 كل يوم شغل
  number                  INT UNSIGNED     NOT NULL,
  customer_id             BIGINT UNSIGNED  NULL,
  -- نسخة من الاسم والموبايل وقت أخد الدور (زبون الشارع مالوش حساب)
  name                    VARCHAR(60)      NOT NULL,
  phone                   VARCHAR(30)      NULL,
  source                  ENUM('app','kiosk','staff') NOT NULL,
  -- الحلاق اللي الزبون طلبه (NULL = «أي حد»)، واللي اشتغل معاه فعلًا
  preferred_barber_id     BIGINT UNSIGNED  NULL,
  barber_id               BIGINT UNSIGNED  NULL,
  status                  ENUM('waiting','serving','done','cancelled','no_show') NOT NULL DEFAULT 'waiting',
  -- ترتيب الطابور: رقم عشري عشان «أخّرني» والتحريك يحطّوا الدور بين اتنين من غير ما نرقّم الكل
  sort_key                DOUBLE           NOT NULL,
  arrived_at              TIMESTAMP        NULL,
  -- جه دوره وهو لسه مش واصل: المهلة بتبدأ من هنا
  called_at               TIMESTAMP        NULL,
  delays_used             TINYINT UNSIGNED NOT NULL DEFAULT 0,
  -- السيستم أخّره مرّة بسبب المهلة (التانية = ما جاش)
  auto_delayed            TINYINT(1)       NOT NULL DEFAULT 0,
  -- زبون غاب كتير: لازم يدوس «جاي» لما دوره يقرّب، وإلا الدور يتلغي
  trust_confirm_required  TINYINT(1)       NOT NULL DEFAULT 0,
  confirmed_at            TIMESTAMP        NULL,
  -- إمتى اتبعت له «قرّب دورك» (مرّة واحدة بس)
  near_notified_at        TIMESTAMP        NULL,
  started_at              TIMESTAMP        NULL,
  finished_at             TIMESTAMP        NULL,
  total                   BIGINT UNSIGNED  NOT NULL DEFAULT 0 COMMENT 'بالقروش',
  ended_by                ENUM('customer','staff','chair','kiosk','system') NULL,
  end_reason              VARCHAR(190)     NULL,
  created_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ticket_number (shop_id, business_date, number),
  KEY ix_ticket_active (shop_id, status, sort_key),
  KEY ix_ticket_customer (customer_id, status),
  KEY ix_ticket_barber (barber_id, status),
  CONSTRAINT fk_ticket_shop FOREIGN KEY (shop_id) REFERENCES shops (id),
  CONSTRAINT fk_ticket_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT fk_ticket_pref_barber FOREIGN KEY (preferred_barber_id) REFERENCES barbers (id),
  CONSTRAINT fk_ticket_barber FOREIGN KEY (barber_id) REFERENCES barbers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- خدمات الدور: نسخة من الاسم والسعر والمدّة وقت الإضافة
CREATE TABLE ticket_services (
  id          BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  ticket_id   BIGINT UNSIGNED   NOT NULL,
  service_id  BIGINT UNSIGNED   NOT NULL,
  name        VARCHAR(80)       NOT NULL,
  price       BIGINT UNSIGNED   NOT NULL,
  minutes     SMALLINT UNSIGNED NOT NULL,
  added_by    ENUM('customer','staff','chair','kiosk') NOT NULL,
  created_at  TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_ticket_services_ticket (ticket_id),
  CONSTRAINT fk_ts_ticket FOREIGN KEY (ticket_id) REFERENCES queue_tickets (id) ON DELETE CASCADE,
  CONSTRAINT fk_ts_service FOREIGN KEY (service_id) REFERENCES services (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- تاريخ كل دور: اتاخد، وصل، اتنادى، اتأخّر، بدأ، خلص، اتلغى…
CREATE TABLE ticket_events (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id   BIGINT UNSIGNED NOT NULL,
  shop_id     BIGINT UNSIGNED NOT NULL,
  type        VARCHAR(30)     NOT NULL,
  actor_type  ENUM('customer','staff','chair','kiosk','display','system') NOT NULL,
  actor_id    BIGINT UNSIGNED NULL,
  data        JSON            NULL,
  created_at  TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_events_ticket (ticket_id, id),
  KEY ix_events_shop (shop_id, created_at),
  CONSTRAINT fk_events_ticket FOREIGN KEY (ticket_id) REFERENCES queue_tickets (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- مدّة كل خدمة عند كل حلاق: متوسّط متحرّك بيتعلّم من الأدوار اللي فيها خدمة واحدة
CREATE TABLE barber_service_stats (
  barber_id    BIGINT UNSIGNED NOT NULL,
  service_id   BIGINT UNSIGNED NOT NULL,
  avg_minutes  DECIMAL(7,2)    NOT NULL,
  samples      INT UNSIGNED    NOT NULL DEFAULT 0,
  updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (barber_id, service_id),
  CONSTRAINT fk_stats_barber FOREIGN KEY (barber_id) REFERENCES barbers (id) ON DELETE CASCADE,
  CONSTRAINT fk_stats_service FOREIGN KEY (service_id) REFERENCES services (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- مفاتيح منع التكرار: لو النت قطع والطلب اتبعت مرّتين، المرّة التانية ترجع نفس الرد
CREATE TABLE idempotency_keys (
  id           BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  scope        VARCHAR(60)       NOT NULL COMMENT 'user:5 · customer:9 · device:3',
  idem_key     VARCHAR(80)       NOT NULL,
  status_code  SMALLINT UNSIGNED NULL,
  body         JSON              NULL,
  created_at   TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_idem (scope, idem_key),
  KEY ix_idem_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

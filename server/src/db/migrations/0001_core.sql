-- ═══════════════════════════════════════════════════════════════
--  0001 — النواة: المحل وإعداداته ومواعيده، والموظفون، والجلسات،
--         والتدقيق، والعدّادات، وصندوق الإشعارات
--
--  المبالغ كلها BIGINT بأصغر وحدة (قروش). التواريخ التقويمية DATE،
--  واللحظات TIMESTAMP (UTC). كل جدول تشغيلي فيه shop_id من أول يوم:
--  النسخة الأولى لمحل واحد، والفروع لاحقًا بدون إعادة بناء.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE shops (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid               CHAR(36)        NOT NULL,
  name               VARCHAR(120)    NOT NULL,
  -- اسم المحل في الرابط العام وفي الـ QR (حروف إنجليزي صغيرة وأرقام وشرطة)
  slug               VARCHAR(60)     NOT NULL,
  phone              VARCHAR(30)     NULL,
  whatsapp           VARCHAR(30)     NULL,
  address            VARCHAR(255)    NULL,
  city               VARCHAR(80)     NULL,
  latitude           DECIMAL(9,6)    NULL,
  longitude          DECIMAL(9,6)    NULL,
  timezone           VARCHAR(60)     NOT NULL DEFAULT 'Africa/Cairo',
  currency           CHAR(3)         NOT NULL DEFAULT 'EGP',
  -- سرّ كود الـ check-in المتغيّر كل دقيقة على شاشة التلفزيون (hex)
  checkin_secret     CHAR(64)        NOT NULL,
  -- مفتاح يدوي: المالك يوقف أخد الأدوار حتى لو المحل في مواعيده (زحمة، عطل)
  accepting_tickets  TINYINT(1)      NOT NULL DEFAULT 1,
  status             ENUM('active','suspended') NOT NULL DEFAULT 'active',
  created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shops_uuid (uuid),
  UNIQUE KEY uq_shops_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- قواعد الطابور. صفّ واحد لكل محل بقيم افتراضية معقولة من أول يوم.
CREATE TABLE shop_settings (
  shop_id                 BIGINT UNSIGNED  NOT NULL,
  -- الزبون ياخد دور من البيت (لو مقفول: الكشك والاستقبال بس)
  remote_tickets_enabled  TINYINT(1)       NOT NULL DEFAULT 1,
  -- حدّ أقصى لأدوار اليوم (NULL = من غير حدّ). مهم قبل العيد.
  max_tickets_per_day     SMALLINT UNSIGNED NULL,
  -- «قرّب دورك» لما يفضل قدّامه العدد ده
  notify_ahead            TINYINT UNSIGNED NOT NULL DEFAULT 2,
  -- مهلة الزبون اللي جه دوره وهو مش واصل
  grace_minutes           TINYINT UNSIGNED NOT NULL DEFAULT 10,
  -- كام مرّة «أخّرني» للدور الواحد
  max_delays              TINYINT UNSIGNED NOT NULL DEFAULT 2,
  -- الأدوار عن بُعد بتقف لما الوقت المتوقّع يبقى أقرب من كده لميعاد القفل
  close_buffer_minutes    SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  -- الأسماء على التلفزيون: «أحمد م.» أو الرقم بس
  display_name_style      ENUM('first_initial','number_only') NOT NULL DEFAULT 'first_initial',
  updated_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (shop_id),
  CONSTRAINT fk_settings_shop FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- مواعيد الشغل: أكتر من فترة في اليوم مسموح. لو closes_at <= opens_at
-- يبقى المحل بيقفل بعد نص الليل (شائع في محلات الحلاقة)، ولو الاتنين
-- متساويين يبقى فاتح 24 ساعة.
CREATE TABLE shop_hours (
  id         BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  shop_id    BIGINT UNSIGNED  NOT NULL,
  weekday    TINYINT UNSIGNED NOT NULL COMMENT '0 = الأحد … 6 = السبت',
  opens_at   TIME             NOT NULL,
  closes_at  TIME             NOT NULL,
  PRIMARY KEY (id),
  KEY ix_hours_shop (shop_id, weekday),
  CONSTRAINT fk_hours_shop FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- موظفو المحل (المالك والمدير والاستقبال). الحلاق مش هنا: ليه PIN في جدول barbers.
CREATE TABLE users (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                  CHAR(36)        NOT NULL,
  shop_id               BIGINT UNSIGNED NOT NULL,
  full_name             VARCHAR(120)    NOT NULL,
  email                 VARCHAR(190)    NOT NULL,
  phone                 VARCHAR(30)     NULL,
  password_hash         VARCHAR(100)    NOT NULL,
  role                  ENUM('owner','manager','cashier') NOT NULL,
  status                ENUM('active','suspended') NOT NULL DEFAULT 'active',
  must_change_password  TINYINT(1)      NOT NULL DEFAULT 0,
  failed_logins         INT UNSIGNED    NOT NULL DEFAULT 0,
  locked_until          TIMESTAMP       NULL,
  last_login_at         TIMESTAMP       NULL,
  password_changed_at   TIMESTAMP       NULL,
  created_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at            TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_uuid (uuid),
  UNIQUE KEY uq_users_email (email),
  KEY ix_users_shop (shop_id, role),
  CONSTRAINT fk_users_shop FOREIGN KEY (shop_id) REFERENCES shops (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- توكنات التجديد للموظفين: نخزّن البصمة فقط. family_id يربط سلسلة التدوير،
-- فإعادة استخدام توكن مستبدَل (علامة سرقة) تُلغي السلسلة كلها.
CREATE TABLE refresh_tokens (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
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
  UNIQUE KEY uq_refresh_hash (token_hash),
  KEY ix_refresh_user (user_id, revoked_at),
  KEY ix_refresh_family (family_id),
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE password_resets (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  token_hash  CHAR(64)        NOT NULL,
  expires_at  TIMESTAMP       NOT NULL,
  used_at     TIMESTAMP       NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_password_resets_hash (token_hash),
  KEY ix_password_resets_user (user_id),
  CONSTRAINT fk_pr_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- سجل التدقيق: مَن غيّر ماذا ومتى (قبل/بعد). لا يُحذف ولا يُعدَّل من التطبيق.
-- (حركة الأدوار نفسها لها سجلّها الخاص ticket_events.)
CREATE TABLE audit_logs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shop_id      BIGINT UNSIGNED NULL,
  user_id      BIGINT UNSIGNED NULL,
  action       VARCHAR(60)     NOT NULL,
  entity       VARCHAR(40)     NOT NULL,
  entity_id    BIGINT UNSIGNED NULL,
  before_json  JSON            NULL,
  after_json   JSON            NULL,
  ip           VARCHAR(45)     NULL,
  user_agent   VARCHAR(255)    NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_audit_entity (entity, entity_id),
  KEY ix_audit_shop (shop_id, created_at),
  KEY ix_audit_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- عدّادات متسلسلة لكل محل تُزاد ذرّيًا (رقم الدور اليومي: name = 'ticket:2026-10-22').
CREATE TABLE counters (
  shop_id  BIGINT UNSIGNED NOT NULL,
  name     VARCHAR(40)     NOT NULL,
  value    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, name),
  CONSTRAINT fk_counters_shop FOREIGN KEY (shop_id) REFERENCES shops (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- صندوق الإشعارات: الرسالة تُكتب هنا (داخل نفس المعاملة) وعامل خلفي يرسلها.
CREATE TABLE notification_outbox (
  id            BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  shop_id       BIGINT UNSIGNED  NULL,
  channel       ENUM('email','push') NOT NULL,
  to_address    VARCHAR(500)     NOT NULL,
  template      VARCHAR(60)      NOT NULL,
  payload       JSON             NOT NULL,
  status        ENUM('pending','sent','failed','skipped') NOT NULL DEFAULT 'pending',
  attempts      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error    VARCHAR(500)     NULL,
  scheduled_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at       TIMESTAMP        NULL,
  created_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_outbox_due (status, scheduled_at),
  KEY ix_outbox_shop (shop_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

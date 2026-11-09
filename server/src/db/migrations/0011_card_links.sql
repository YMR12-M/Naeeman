-- ═══════════════════════════════════════════════════════════════
--  0011 — ربط كارت المحل بحساب التطبيق بكود من الاستقبال
--
--  رقم الموبايل في حساب التطبيق مش متأكّد منه (مفيش SMS)، فأي حد ممكن
--  يسجّل برقم غيره. عشان كده الحساب ما بيترَبطش لوحده بكارت الموبايل
--  القديم (أختامه وصور قصّاته): الاستقبال بيطلّع كود من 6 أرقام وهو شايف
--  صاحب الكارت قدّامه، والزبون بيكتبه في التطبيق، والكارتين بيبقوا واحد.
--
--  كارت الحساب ما بيمسكش رقم الموبايل: الرقم بيفضل لكارت الموبايل (زباين
--  الشارع والكشك) لحد ما الربط يحصل.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE card_link_codes (
  id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  shop_id             BIGINT UNSIGNED  NOT NULL,
  shop_customer_id    BIGINT UNSIGNED  NOT NULL,
  code_hash           CHAR(64)         NULL,
  expires_at          TIMESTAMP        NOT NULL,
  used_at             TIMESTAMP        NULL,
  attempts            TINYINT UNSIGNED NOT NULL DEFAULT 0,
  issued_by           BIGINT UNSIGNED  NULL,
  linked_customer_id  BIGINT UNSIGNED  NULL,
  created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_link_codes_card (shop_customer_id, used_at),
  CONSTRAINT fk_link_codes_shop FOREIGN KEY (shop_id) REFERENCES shops (id),
  CONSTRAINT fk_link_codes_card FOREIGN KEY (shop_customer_id) REFERENCES shop_customers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- الكروت اللي اترَبطت لوحدها قبل كده بالرقم: الرقم يرجع حرّ، فزيارة جديدة
-- بنفس الرقم من الاستقبال أو الكشك ما تروحش لحساب ممكن ما يكونش صاحبه.
UPDATE shop_customers SET phone = NULL WHERE customer_id IS NOT NULL;

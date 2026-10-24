-- ═══════════════════════════════════════════════════════════════
--  0006 — استعادة كلمة سر الزبون من المحل
--
--  الزبون اللي ما حطّش بريد مالوش رابط استعادة. الحل: الاستقبال يطلّع له
--  كود من 6 أرقام وهو واقف قدّامه في المحل (صالح ربع ساعة، مرّة واحدة)،
--  والزبون يكتبه في التطبيق مع رقمه وكلمة سر جديدة.
--
--  الكود قصير، فبيتقفل بعد 5 محاولات غلط. بنخزّن بصمته بس (مربوطة برقم
--  الطلب)، و`token_hash` للطلب ده قيمة عشوائية ملهاش استعمال غير إنها فريدة.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE customer_password_resets
  ADD COLUMN kind      ENUM('email','shop') NOT NULL DEFAULT 'email' AFTER customer_id,
  ADD COLUMN code_hash CHAR(64)          NULL AFTER token_hash,
  ADD COLUMN attempts  TINYINT UNSIGNED  NOT NULL DEFAULT 0 AFTER used_at,
  ADD COLUMN issued_by BIGINT UNSIGNED   NULL AFTER attempts,
  ADD KEY ix_cpr_customer_kind (customer_id, kind, used_at);

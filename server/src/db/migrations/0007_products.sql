-- ═══════════════════════════════════════════════════════════════
--  0007 — المنتجات والمخزن
--
--  المنتج زي الخدمة: ما بيتمسحش (الفواتير القديمة بتشاور عليه)، «المسح»
--  أرشفة. الكمية في `stock_qty` بتتغيّر بس من خلال حركة في
--  `stock_movements` (شراء، بيع، مرتجع، جرد، استهلاك)، فأي رقم في
--  المخزن ليه أصل. الكمية ممكن تنزل تحت الصفر: العدّ مش دايمًا مظبوط،
--  والبيع ما يتعطّلش عشان الرقم غلط.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE products (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shop_id       BIGINT UNSIGNED NOT NULL,
  name          VARCHAR(80)     NOT NULL,
  -- الماسح بيكتب الباركود زي الكيبورد. اختياري، وفريد جوّه المحل.
  barcode       VARCHAR(40)     NULL,
  price         BIGINT UNSIGNED NOT NULL COMMENT 'سعر البيع بالقروش',
  -- متوسّط التكلفة المرجّح: بيتحدّث مع كل شراء
  cost          BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'بالقروش',
  track_stock   TINYINT(1)      NOT NULL DEFAULT 1,
  stock_qty     INT             NOT NULL DEFAULT 0,
  -- تنبيه «قرّب يخلص» لما الكمية توصل للرقم ده (NULL = من غير تنبيه)
  low_stock_at  INT UNSIGNED    NULL,
  active        TINYINT(1)      NOT NULL DEFAULT 1,
  sort_order    INT             NOT NULL DEFAULT 0,
  archived_at   TIMESTAMP       NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_barcode (shop_id, barcode),
  KEY ix_products_shop (shop_id, archived_at, sort_order),
  CONSTRAINT fk_products_shop FOREIGN KEY (shop_id) REFERENCES shops (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE stock_movements (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shop_id      BIGINT UNSIGNED NOT NULL,
  product_id   BIGINT UNSIGNED NOT NULL,
  -- purchase شراء · sale بيع · refund مرتجع · adjust جرد · use استهلاك جوّه المحل
  type         ENUM('purchase','sale','refund','adjust','use') NOT NULL,
  qty          INT             NOT NULL COMMENT 'موجب = دخل المخزن، سالب = خرج',
  unit_cost    BIGINT UNSIGNED NULL COMMENT 'للشراء: تكلفة الوحدة بالقروش',
  stock_after  INT             NOT NULL,
  bill_id      BIGINT UNSIGNED NULL,
  note         VARCHAR(190)    NULL,
  created_by   BIGINT UNSIGNED NULL,
  created_at   TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_stock_product (product_id, id),
  KEY ix_stock_shop (shop_id, created_at),
  KEY ix_stock_bill (bill_id),
  CONSTRAINT fk_stock_shop FOREIGN KEY (shop_id) REFERENCES shops (id),
  CONSTRAINT fk_stock_product FOREIGN KEY (product_id) REFERENCES products (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

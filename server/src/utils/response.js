/**
 * شكل الاستجابة الموحّد:
 *   نجاح  → { success: true, data, meta? }
 *   فشل   → { success: false, message, code, errors? }   (من errorHandler)
 */
export const ok = (res, data = null, status = 200) =>
  res.status(status).json({ success: true, data });

export const created = (res, data) => ok(res, data, 201);

export const noContent = (res) => res.status(204).end();

/** قائمة مقسّمة صفحات + meta */
export const paged = (res, rows, meta) =>
  res.json({ success: true, data: rows, meta });

export const pageMeta = (page, pageSize, total) => ({
  page,
  page_size: pageSize,
  total,
  total_pages: Math.max(1, Math.ceil(total / pageSize)),
});

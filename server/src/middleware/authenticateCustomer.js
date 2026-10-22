/**
 * التحقّق من هوية الزبون (توكن بجمهور `naeeman-customer`).
 * توكن الموظف مرفوض هنا، وتوكن الزبون مرفوض في مسارات الموظفين.
 * بنحمّل الزبون من القاعدة في كل طلب: إيقاف الحساب يسري فورًا.
 */
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { decodeBearer } from './authenticate.js';
import { loadCustomer } from '../modules/customers/customerAuth.service.js';

export const authenticateCustomer = asyncHandler(async (req, _res, next) => {
  const payload = decodeBearer(req, 'customer');
  const customer = await loadCustomer(Number(payload.sub));
  if (!customer) throw ApiError.unauthorized('الحساب غير موجود', { code: 'CUSTOMER_NOT_FOUND' });
  if (customer.status !== 'active') throw ApiError.forbidden('الحساب موقوف', { code: 'CUSTOMER_BLOCKED' });
  req.customer = customer;
  req.authExpiresAt = payload.exp * 1000;
  next();
});

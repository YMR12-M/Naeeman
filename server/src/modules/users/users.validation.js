import { z } from 'zod';
import { ROLES } from '../../config/permissions.js';
import { emailSchema, passwordSchema, phoneSchema } from '../../utils/schemas.js';

const optionalPhone = z.union([phoneSchema, z.literal('').transform(() => null), z.null()]).optional();

export const createUserSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: emailSchema,
  phone: optionalPhone,
  role: z.enum(ROLES),
  /** لو اتحدّدت تُستخدم، وإلا تُولَّد مؤقتة. يلزم تغييرها عند أول دخول في الحالتين. */
  password: passwordSchema.optional(),
  /** يبعت رابط تحديد كلمة المرور بالبريد بدل ما يرجّع كلمة مؤقتة */
  send_invite: z.boolean().default(true),
});

export const updateUserSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  phone: optionalPhone,
  role: z.enum(ROLES),
  status: z.enum(['active', 'suspended']),
}).partial();

export const listUsersQuery = z.object({
  role: z.enum(ROLES).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  q: z.string().trim().max(80).optional(),
});

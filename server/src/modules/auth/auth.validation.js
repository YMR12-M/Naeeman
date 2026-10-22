import { z } from 'zod';
import { emailSchema, passwordSchema, phoneSchema } from '../../utils/schemas.js';

const optionalPhone = z.union([phoneSchema, z.literal('').transform(() => null), z.null()]).optional();

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

/** الويب يرسل التوكن في كوكي، والتطبيقات في الجسم */
export const refreshSchema = z.object({
  refresh_token: z.string().min(20).max(300).optional(),
});

export const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(128),
  new_password: passwordSchema,
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(300),
  new_password: passwordSchema,
});

export const updateProfileSchema = z.object({
  full_name: z.string().trim().min(2).max(120).optional(),
  phone: optionalPhone,
});

export const sessionParams = z.object({ familyId: z.string().uuid('معرّف الجلسة غير صالح') });

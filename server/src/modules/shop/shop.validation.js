import { z } from 'zod';
import { optionalText, phoneSchema, requiredText, timeOfDay } from '../../utils/schemas.js';
import { overlappingPeriods } from '../../utils/hours.js';

const optionalPhone = z.union([phoneSchema, z.literal('').transform(() => null), z.null()]).optional();

export const updateShopSchema = z.object({
  name: requiredText(120),
  phone: optionalPhone,
  whatsapp: optionalPhone,
  address: optionalText(255),
  city: optionalText(80),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  accepting_tickets: z.boolean(),
}).partial().strict();

const period = z.object({
  weekday: z.number().int().min(0).max(6),
  opens_at: timeOfDay,
  closes_at: timeOfDay,
});

/** الأسبوع كله مرّة واحدة: اللي مش موجود يبقى اليوم ده إجازة */
export const hoursSchema = z.object({
  periods: z.array(period).max(21),
}).superRefine(({ periods }, ctx) => {
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    const day = periods.filter((item) => item.weekday === weekday);
    if (day.length > 3) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['periods'], message: 'أقصى حاجة 3 فترات في اليوم' });
    }
    if (overlappingPeriods(day)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['periods'], message: 'فيه فترتين متداخلين في نفس اليوم' });
    }
  }
});

export const settingsSchema = z.object({
  remote_tickets_enabled: z.boolean(),
  max_tickets_per_day: z.number().int().min(1).max(2000).nullable(),
  notify_ahead: z.number().int().min(1).max(10),
  grace_minutes: z.number().int().min(2).max(60),
  max_delays: z.number().int().min(0).max(5),
  close_buffer_minutes: z.number().int().min(0).max(240),
  display_name_style: z.enum(['first_initial', 'number_only']),
}).partial().strict();

import { registerJob } from './index.js';
import { queueService } from '../modules/queue/queue.service.js';
import { purgeIdempotencyKeys } from '../middleware/idempotency.js';
import { logger } from '../utils/logger.js';

/** مهل الطابور: اللي اتنادى وما وصلش، واللي لازم يأكّد وما أكّدش، وأدوار يوم خلص */
registerJob({
  name: 'queue-sweep',
  everyMs: 30_000,
  run: async () => {
    for (const shopId of await queueService.activeShops()) {
      try {
        await queueService.sweep(shopId);
      } catch (error) {
        logger.error(`فشل تطبيق مهل الطابور (محل ${shopId}): ${error.message}`);
      }
    }
  },
});

registerJob({
  name: 'idempotency-purge',
  everyMs: 6 * 60 * 60_000,
  run: () => purgeIdempotencyKeys(),
});

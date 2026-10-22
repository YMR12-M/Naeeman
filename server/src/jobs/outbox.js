import { registerJob } from './index.js';
import { processOutbox, purgeOutbox } from '../services/notifications/outbox.js';

registerJob({
  name: 'outbox',
  everyMs: 20_000,
  run: () => processOutbox(),
});

registerJob({
  name: 'outbox-purge',
  everyMs: 6 * 60 * 60_000,
  run: () => purgeOutbox(),
});

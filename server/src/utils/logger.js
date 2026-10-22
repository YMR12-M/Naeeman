/**
 * مسجّل بسيط: ألوان ANSI في التطوير، وأسطر JSON في الإنتاج
 * (تقبلها أدوات تجميع اللوجات مباشرة). نفس النداءات في الحالتين،
 * فيمكن استبداله بـ pino لاحقًا دون لمس باقي الكود.
 */
const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const COLORS = {
  reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m',
  green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

const stamp = () => new Date().toISOString().slice(11, 19);

function emit(level, symbol, color, stream, message, meta) {
  if (isTest && level !== 'error') return; // لا نلوّث مخرجات الاختبار
  if (isProd) {
    stream(JSON.stringify({ level, time: new Date().toISOString(), msg: String(message), ...meta }));
    return;
  }
  stream(`${color}[${stamp()}] ${symbol}${COLORS.reset} ${message}`);
}

export const logger = {
  info: (msg, meta) => emit('info', '›', COLORS.cyan, console.log, msg, meta),
  success: (msg, meta) => emit('info', '✔', COLORS.green, console.log, msg, meta),
  warn: (msg, meta) => emit('warn', '⚠', COLORS.yellow, console.warn, msg, meta),
  error: (msg, meta) => emit('error', '✖', COLORS.red, console.error, msg, meta),
  debug: (msg, meta) => { if (!isProd) emit('debug', '·', COLORS.dim, console.log, msg, meta); },
};

# ═══════════════════════════════════════════════════════════════
#  سيرفر نعيمًا (API)
#  عند كل تشغيل: migrations اللي لسه، وبعدين أوّل مالك لو مفيش (آمن للتكرار)،
#  وبعدين السيرفر. الإعدادات كلها من متغيّرات البيئة (شوف .env.example).
# ═══════════════════════════════════════════════════════════════
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=4030

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src

USER node
EXPOSE 4030
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

CMD ["sh", "-c", "node src/db/migrate.js up && (node src/db/bootstrap.js || true) && exec node src/server.js"]

# ═══════════════════════════════════════════════════════════════
#  الواجهتين على nginx: لوحة المحل (بورت 80) وتطبيق الزبون (بورت 8080)
#  نفس العنوان بيوصّل /api للسيرفر، فمفيش CORS والكوكي على نفس الموقع.
#  البناء من جذر الريبو:  docker build -f deploy/web.Dockerfile .
# ═══════════════════════════════════════════════════════════════
FROM node:22-alpine AS client
WORKDIR /build
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-alpine AS mobile
WORKDIR /build
COPY mobile/package*.json ./
RUN npm ci
COPY mobile/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=client /build/dist /usr/share/nginx/panel
COPY --from=mobile /build/dist /usr/share/nginx/app
EXPOSE 80 8080

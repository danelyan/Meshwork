# Сборка стенда: Next.js standalone (docs Next.js: output 'standalone', пример with-docker).
FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# builder — также образ для одноразовых задач (миграции, сид): в нём полный node_modules.
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Корневой макет читает окружение (getEnv) уже при попытке пререндера, а .env в образ не попадает:
# без обязательных переменных сборка падает. Заглушки действуют только в этой команде; страницы
# рендерятся по запросу (шапка читает куки) и берут настоящее окружение контейнера.
# Ресурсы MediaPipe (слежение за лицом в комнате звонка): npm-хуки prebuild здесь не срабатывают — вызываем явно.
RUN node scripts/mediapipe-assets.mjs
RUN npx prisma generate \
  && DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
     SESSION_SECRET=build-time-placeholder-not-a-secret-000 \
     npx next build

FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Разбор DOCX (collector/parse-worker.ts) грузит mammoth через createRequire в worker-потоке: трассировка
# standalone его не видит, и в образе пакета не было (DOCX на стенде падал MODULE_NOT_FOUND). Копируем пакет
# с полным деревом зависимостей (node -e обход package.json, 11.10).
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/mammoth ./node_modules/mammoth
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@xmldom/xmldom ./node_modules/@xmldom/xmldom
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/sprintf-js ./node_modules/sprintf-js
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/base64-js ./node_modules/base64-js
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/dingbat-to-unicode ./node_modules/dingbat-to-unicode
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/jszip ./node_modules/jszip
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/lie ./node_modules/lie
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/immediate ./node_modules/immediate
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pako ./node_modules/pako
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/readable-stream ./node_modules/readable-stream
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/core-util-is ./node_modules/core-util-is
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/inherits ./node_modules/inherits
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/isarray ./node_modules/isarray
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/process-nextick-args ./node_modules/process-nextick-args
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/safe-buffer ./node_modules/safe-buffer
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/string_decoder ./node_modules/string_decoder
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/util-deprecate ./node_modules/util-deprecate
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/setimmediate ./node_modules/setimmediate
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/lop ./node_modules/lop
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/duck ./node_modules/duck
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/underscore ./node_modules/underscore
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/option ./node_modules/option
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/xmlbuilder ./node_modules/xmlbuilder
# lane call: аудио созвонов (CALL_DATA_DIR=./data). Папка своя у nextjs — том app-data наследует владельца.
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]

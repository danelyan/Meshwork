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
# lane call: аудио созвонов (CALL_DATA_DIR=./data). Папка своя у nextjs — том app-data наследует владельца.
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]

# Сервис runner: автопроверка проектов кандидатов скрытыми тестами (ADR 0003, runner/README.md).
# Сборка из каталога platform/: docker build -f runner/Dockerfile .  (в compose – сервис runner)
# Один образ на оба «образа» контракта: node20 (Node 20 + vitest/supertest/testing-library/express)
# и python312 (Python 3.12 + pytest/fastapi/httpx/numpy/pandas; numpy/pandas – колёса musllinux, без сборки). Docker внутри не нужен и недоступен.

FROM node:20-alpine3.21 AS build
WORKDIR /build
COPY runner/package.json runner/package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY runner/src ./src
RUN npx esbuild src/main.ts --bundle --platform=node --target=node20 --format=esm --outfile=dist/server.mjs

# setuid-помощник смены uid задания (sandbox/helper/fsp-sandbox.c), статическая сборка musl.
FROM alpine:3.21 AS helper
RUN apk add --no-cache build-base
COPY runner/sandbox/helper/fsp-sandbox.c /src/
RUN gcc -O2 -static -Wall -Wextra -Werror -DCALLER_UID=1001 -DSANDBOX_UID=2000 -DSANDBOX_GID=2000 \
      -o /src/fsp-sandbox /src/fsp-sandbox.c && strip /src/fsp-sandbox

# Предустановленные пакеты для заданий: кандидату зависимости не ставятся, скрипты пакетов не выполняются.
FROM node:20-alpine3.21 AS sandbox-node
WORKDIR /opt/runner-deps/node
COPY runner/sandbox/node/package.json runner/sandbox/node/package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts

FROM node:20-alpine3.21 AS runner
RUN apk add --no-cache python3 tini
COPY runner/sandbox/python/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/runner-py \
  && /opt/runner-py/bin/pip install --no-cache-dir --disable-pip-version-check -r /tmp/requirements.txt \
  && rm /tmp/requirements.txt
# Сервис – runner (1001), задание – sandbox (2000). runner входит в группу sandbox: отдаёт заданию
# tmp/ и out/ (setgid-каталоги) и читает его отчёт. sandbox ни в какие группы сервиса не входит.
RUN addgroup -S -g 1001 runner && adduser -S -D -H -u 1001 -G runner -s /sbin/nologin runner \
  && addgroup -S -g 2000 sandbox && adduser -S -D -H -u 2000 -G sandbox -s /sbin/nologin sandbox \
  && addgroup runner sandbox
COPY --from=sandbox-node /opt/runner-deps/node/node_modules /opt/runner-deps/node/node_modules
COPY runner/sandbox/node/vitest.job.config.mjs runner/sandbox/python/pytest.job.ini /opt/runner/
# Шаблоны (скрытые тесты всех шаблонов) читает только сервис: задание получает копию одного набора.
COPY --chown=runner:runner project-templates /opt/runner/templates
COPY --from=build /build/dist/server.mjs /opt/runner/server.mjs
# Помощник: владелец root, запуск только группе runner (sandbox его выполнить не может), setuid.
COPY --from=helper /src/fsp-sandbox /opt/runner/bin/fsp-sandbox
RUN chown root:runner /opt/runner/bin/fsp-sandbox && chmod 4750 /opt/runner/bin/fsp-sandbox \
  && chmod -R go-rwx /opt/runner/templates && chmod 0755 /opt/runner /opt/runner/bin \
  && mkdir -p /work && chown runner:runner /work && chmod 0711 /work
ENV NODE_ENV=production \
    RUNNER_PORT=8090 \
    RUNNER_WORK_DIR=/work \
    RUNNER_TEMPLATES_DIR=/opt/runner/templates \
    RUNNER_NODE_BIN=/usr/local/bin/node \
    RUNNER_NODE_DEPS=/opt/runner-deps/node/node_modules \
    RUNNER_VITEST_CONFIG=/opt/runner/vitest.job.config.mjs \
    RUNNER_PYTHON=/opt/runner-py/bin/python \
    RUNNER_PYTEST_INI=/opt/runner/pytest.job.ini \
    RUNNER_SANDBOX_HELPER=/opt/runner/bin/fsp-sandbox \
    RUNNER_SANDBOX_GID=2000
# Сервис – непривилегированный uid; capabilities в контейнере – только SETUID/SETGID в bounding set
# (их получает лишь setuid-помощник на время смены uid). См. runner/README.md «Изоляция».
USER 1001:1001
EXPOSE 8090
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "/opt/runner/server.mjs"]

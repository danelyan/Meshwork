# API реестра ФСП (симулятор). Сборка: docker build -t fsp-sim-api .  (в compose — сервис api)
FROM node:24-alpine AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
RUN apk add --no-cache tini
WORKDIR /app
COPY --from=build /build/dist/server.mjs ./server.mjs
COPY data ./data
ENV NODE_ENV=production \
    PORT=8080 \
    FSP_DATA_FILE=/app/data/dataset.json
USER node
EXPOSE 8080
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.mjs"]

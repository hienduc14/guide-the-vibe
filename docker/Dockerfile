# gtv Operator server + dashboard

# 1) dashboard (web/) → static files
FROM node:24-trixie-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# 2) server
FROM node:24-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory '*'
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev
COPY src ./src
COPY bin ./bin
COPY --from=web /web/dist ./web/dist
ENV GTV_DATA=/data GTV_PORT=7390 GTV_HOST=0.0.0.0 GTV_WEB_DIR=/app/web/dist
# Set by docker/auto-deploy.sh (docker compose build --build-arg GTV_COMMIT=…); shown on the dashboard.
ARG GTV_COMMIT=""
ENV GTV_COMMIT=$GTV_COMMIT
EXPOSE 7390
CMD ["node", "src/server/main.ts"]

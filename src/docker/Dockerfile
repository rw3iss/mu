# Stage 1: Build
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

# Install dependencies
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Copy source
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
COPY packages/client/ packages/client/

# Build all packages
RUN pnpm run build

# Stage 2: Production
FROM node:22-alpine AS production

RUN apk add --no-cache ffmpeg && \
    corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod 2>/dev/null || pnpm install --prod

# Copy built output
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/client/dist packages/client/dist

# Copy server config files
COPY packages/server/nest-cli.json packages/server/

# Create data directory
RUN mkdir -p /app/data/db /app/data/cache/images /app/data/cache/streams /app/data/cache/subtitles /app/data/logs

# Environment defaults
ENV NODE_ENV=production
ENV MU_SERVER_HOST=0.0.0.0
ENV MU_SERVER_PORT=8080
ENV MU_DATA_DIR=/app/data
ENV MU_DATABASE_SQLITE_PATH=/app/data/db/mu.db

EXPOSE 8080

VOLUME ["/app/data", "/media"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/v1/health || exit 1

CMD ["node", "packages/server/dist/main.js"]

# ─── Senviok — Multi-stage Docker Build ────────────────────────────────────────
# Builds both the API server and email worker from the same image.
# Use CMD override to run the worker: ["node", "dist/workers/emailWorker.js"]

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json ./
RUN npm ci

# Generate Prisma client
COPY prisma ./prisma
RUN npx prisma generate

# Build TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy Prisma schema + generated client
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy built JS
COPY --from=builder /app/dist ./dist

# Non-root user for security
RUN addgroup -g 1001 -S senviok && \
    adduser -S senviok -u 1001 -G senviok
USER senviok

ENV NODE_ENV=production
EXPOSE 3000

# Default: run API server. Override for worker.
CMD ["node", "dist/server.js"]

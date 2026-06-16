# ─────────────────────────────────────────────────────────────────
#  PIE Foods Backend — Cloud Run image
# ─────────────────────────────────────────────────────────────────
#  Two stages:
#    1. builder — installs dev deps, compiles TypeScript to dist/
#    2. runtime — slim image with only prod deps + dist/
#
#  Cloud Run injects $PORT (default 8080). server.ts already uses
#  process.env.PORT, so no code changes needed.
# ─────────────────────────────────────────────────────────────────

# ---- Build stage ----
FROM node:20-slim AS builder

WORKDIR /app

# Install deps (incl. devDependencies) — needed for `tsc`
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# Copy sources + compile TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build


# ---- Runtime stage ----
FROM node:20-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# Production-only deps (smaller, faster cold start)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# Built JS from the builder stage
COPY --from=builder /app/dist ./dist

# Run as non-root for security
RUN groupadd -r app && useradd -r -g app app \
 && chown -R app:app /app
USER app

EXPOSE 8080

CMD ["node", "dist/server.js"]

# Self-hosted production image (docker-compose.prod.yml). Not used by Vercel.
# Requires next.config.ts's `output: 'standalone'`, gated on DOCKER_BUILD below.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DOCKER_BUILD=1
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time-only placeholders so src/lib/env.ts's schema check passes while
# Next "collects page data" for route handlers (it evaluates their modules).
# Real secrets are injected at container start via docker-compose.prod.yml's
# env_file — Node re-validates against those on every `node server.js` start,
# so these placeholders are never actually used to reach anything.
ENV MONGODB_URI="mongodb://placeholder:27017/placeholder"
ENV AUTH_SECRET="build-time-placeholder-not-used-at-runtime"
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]

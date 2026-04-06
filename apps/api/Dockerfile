# ── Stage 1: Install dependencies ──
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/

RUN npm ci --workspace=@knowledge-platform/api --include-workspace-root

# ── Stage 2: Build ──
FROM deps AS build
WORKDIR /app

COPY apps/api/ apps/api/

RUN npx prisma generate --schema=apps/api/prisma/schema.prisma
RUN npm run build -w @knowledge-platform/api

# ── Stage 3: Production runtime ──
FROM node:22-alpine
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/node_modules/.prisma ./apps/api/node_modules/.prisma

COPY package.json ./
COPY apps/api/package.json apps/api/

ENV NODE_ENV=production
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --spider http://localhost:3001/health || exit 1

CMD ["node", "apps/api/dist/index.js"]

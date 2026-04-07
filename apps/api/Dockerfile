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

RUN mkdir -p /app/uploads && chown -R node:node /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=node:node /app/apps/api/node_modules/.prisma ./apps/api/node_modules/.prisma

COPY --chown=node:node package.json ./
COPY --chown=node:node apps/api/package.json apps/api/

ENV NODE_ENV=production
EXPOSE 3001

USER node

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --spider http://localhost:3001/health || exit 1

CMD ["node", "apps/api/dist/index.js"]

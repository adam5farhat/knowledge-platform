# ── Stage 1: Install dependencies ──
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/

RUN npm ci --workspace=@knowledge-platform/web --include-workspace-root

# ── Stage 2: Build ──
FROM deps AS build
WORKDIR /app

COPY apps/web/ apps/web/

ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ARG PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV PUBLIC_API_URL=$PUBLIC_API_URL

RUN npm run build -w @knowledge-platform/web

# ── Stage 2b: Prune devDependencies ──
FROM deps AS pruned
WORKDIR /app
RUN npm prune --omit=dev

# ── Stage 3: Production runtime ──
FROM node:22-alpine
WORKDIR /app

RUN chown -R node:node /app

ENV NODE_ENV=production

COPY --from=pruned --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/web/.next ./apps/web/.next
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /app/apps/web/package.json ./apps/web/package.json
COPY --chown=node:node package.json ./

EXPOSE 3000

USER node

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --spider http://localhost:3000/ || exit 1

CMD ["npm", "run", "start", "-w", "@knowledge-platform/web"]

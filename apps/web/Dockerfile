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

# ── Stage 3: Production runtime ──
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY package.json ./

EXPOSE 3000

CMD ["npm", "run", "start", "-w", "@knowledge-platform/web"]

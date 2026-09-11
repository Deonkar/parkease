FROM node:24.9.0-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile --filter @parkease/worker...

FROM base AS build
COPY --from=deps /app .
COPY tsconfig.base.json .
COPY packages/ packages/
COPY apps/worker/ apps/worker/
RUN pnpm turbo run build --filter=@parkease/worker...

FROM node:24.9.0-alpine AS runtime
WORKDIR /app
COPY --from=build /app/apps/worker/dist ./dist
COPY --from=build /app/node_modules ./node_modules
ENV NODE_ENV=production
CMD ["node", "dist/main.js"]

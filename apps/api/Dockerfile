FROM node:24.9.0-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile --filter @parkease/api...

FROM base AS build
COPY --from=deps /app .
COPY tsconfig.base.json .
COPY packages/ packages/
COPY apps/api/ apps/api/
RUN pnpm turbo run build --filter=@parkease/api...

FROM node:24.9.0-alpine AS runtime
WORKDIR /app
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/main.js"]

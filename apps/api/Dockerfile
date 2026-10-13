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
COPY tsconfig.base.json turbo.json .
COPY packages/ packages/
COPY apps/api/ apps/api/
RUN pnpm turbo run build --filter=@parkease/api...

# ponytail: workspace packages export raw .ts (exports -> src/index.ts), so the image keeps the
# full build workspace and runs under tsx. Slim to `pnpm deploy --prod` once packages emit dist.
FROM build AS runtime
WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3000
# alpine has no curl
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get({port:3000,path:'/api/v1/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
# The image's unprivileged user: a compromised process can't rewrite the app or the system.
USER node
CMD ["node", "--import", "tsx", "dist/main.js"]

# ParkEase

Peer-to-peer parking marketplace for India. Drivers find and book parking; owners
monetise unused slots. Valet and car-wash services layer on top.

## Status

Pre-implementation. Scaffolding is task 1 of 22.

## Stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| API | NestJS 11 on the Fastify adapter |
| Worker | pg-boss, transactional outbox |
| Database | PostgreSQL 18 + PostGIS 3.6, Drizzle ORM |
| Contracts | Zod, shared across API, mobile, admin and OpenAPI |
| Mobile | Expo SDK 57, React Native 0.86, New Architecture |
| Admin | React 19 + Vite + Ant Design 5 + TanStack Router |
| Web | Next.js 15, App Router, Tailwind 4 |
| Runtime | Node.js 24 LTS |

## Development

```bash
pnpm install
docker compose up -d      # PostgreSQL 18 + PostGIS 3.6 + Redis 7
pnpm dev
```

## Notes

Architecture decisions, coding rules and implementation tasks are maintained
outside this repository.

## License

Proprietary. All rights reserved.

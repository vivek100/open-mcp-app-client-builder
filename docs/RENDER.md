# Render quick reference

**Full deployment guide:** **[`docs/DEPLOY.md`](DEPLOY.md)** — steps, env vars, E2B template, checklist, troubleshooting.

**Blueprint:** monorepo root **`render.yaml`** — `buildCommand`, `startCommand`, `NODE_VERSION`, and env keys (`sync: false` for secrets; set values in the Render dashboard).

## Monorepo root (required)

Render only includes files under the service **root directory**. This repo must use the **pnpm workspace root** (where **`pnpm-lock.yaml`** lives), **not** **`apps/web`** alone — otherwise install fails.

## Web Service, not static

Use a **Node Web Service** with **`pnpm --filter web start`**. Do not deploy as a **Static Site**; the app needs API routes and streaming.

## Official Render docs

- [Deploy a Next.js app](https://render.com/docs/deploy-nextjs-app)
- [Monorepo support](https://render.com/docs/monorepo-support)
- [Node version](https://render.com/docs/node-version)
- [Blueprints](https://render.com/docs/infrastructure-as-code)

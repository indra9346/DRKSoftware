# Used by Cloudflare Containers (wrangler.jsonc) and Render (render.yaml).
# Stage 1 builds the screens and the server; stage 2 holds only what runs, so the image stays
# small and starts fast.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN CI=1 pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN CI=1 pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
# Database migrations, applied on start when AUTO_MIGRATE=true.
COPY drizzle ./drizzle
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/index.js"]

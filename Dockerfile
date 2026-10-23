FROM node:24.22.1-alpine3.24 AS base

RUN corepack enable && corepack prepare pnpm@11.25.0 --activate


# Build stage
FROM base AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN pnpm install \
    --frozen-lockfile \
    --ignore-scripts \
    --store-dir=/pnpm/store

COPY . .

# Allow Node.js to use more memory during the NestJS build
ENV NODE_OPTIONS="--max-old-space-size=2048"

RUN pnpm run build


# Production stage
FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=7000

COPY package.json pnpm-lock.yaml ./

RUN pnpm install \
    --frozen-lockfile \
    --prod \
    --ignore-scripts \
    --store-dir=/pnpm/store

COPY --from=builder /app/dist ./dist

EXPOSE 7000

CMD ["node", "dist/main.js"]

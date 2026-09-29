FROM docker.1ms.run/library/node:20-alpine3.18 AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS deps
ARG NPM_REGISTRY=https://registry.npmmirror.com
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm config set registry "${NPM_REGISTRY}" && \
    npm ci --prefer-offline --no-audit --no-fund

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/package.json ./package.json

USER nestjs
EXPOSE 3000
CMD ["npm", "run", "start:prod"]

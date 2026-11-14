FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

ENV NODE_ENV=production
ENV PORT=4173
EXPOSE 4173

CMD ["node", "server.mjs"]

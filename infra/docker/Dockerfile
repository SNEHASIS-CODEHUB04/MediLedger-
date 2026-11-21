FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY apps apps
COPY packages packages
RUN npm run db:generate

FROM build AS api-build
RUN npm run build -w @mediledger/api

FROM api-build AS api
ENV NODE_ENV=production BIND_HOST=0.0.0.0 FILE_STORAGE_ROOT=/data
RUN install -d -o node -g node -m 0700 /data
USER node
CMD ["npm", "run", "start", "-w", "@mediledger/api"]

FROM build AS web-build
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_DEMO_ENTRY=true
ARG NEXT_PUBLIC_DEMO_FIXTURES_ONLY=true
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_DEMO_ENTRY=$NEXT_PUBLIC_DEMO_ENTRY NEXT_PUBLIC_DEMO_FIXTURES_ONLY=$NEXT_PUBLIC_DEMO_FIXTURES_ONLY
RUN npm run build -w @mediledger/web

FROM nginx:alpine AS web
COPY --from=web-build /app/apps/web/out /usr/share/nginx/html
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf

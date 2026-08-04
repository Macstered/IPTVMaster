FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
RUN npm ci

COPY tsconfig.base.json eslint.config.js .prettierrc.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app

ARG IPTVMASTER_VERSION=development
ARG IPTVMASTER_REVISION=unknown

LABEL org.opencontainers.image.title="IPTVMaster" \
    org.opencontainers.image.version="$IPTVMASTER_VERSION" \
    org.opencontainers.image.revision="$IPTVMASTER_REVISION" \
    org.opencontainers.image.source="https://github.com/Macstered/IPTVMaster"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    PUBLIC_DIR=/app/public \
    IPTVMASTER_VERSION=$IPTVMASTER_VERSION \
    IPTVMASTER_REVISION=$IPTVMASTER_REVISION

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/core/package.json packages/core/package.json
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./public
COPY --from=build /app/packages/core/dist ./packages/core/dist

USER node
EXPOSE 8080
CMD ["node", "apps/api/dist/server.js"]

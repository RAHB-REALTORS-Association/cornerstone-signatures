FROM node:26-alpine AS base
# Refresh OS fixes even when the upstream Node image has not been rebuilt yet.
RUN apk upgrade --no-cache

FROM base AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Dependabot PRs do not rewrite committed bundles. Always compile the image's
# assets from its own locked dependencies, without shipping development tools.
FROM base AS addin-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY scripts ./scripts
COPY outlook-addin ./outlook-addin
RUN npm run build:addin

FROM base AS runtime
WORKDIR /app

# Package managers are build tools; their bundled dependency trees are not
# covered by the application's lockfile and are unnecessary at runtime.
RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn-* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/app/data/cornerstone-signatures.db

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY admin ./admin
COPY static ./static
COPY outlook-addin ./outlook-addin
COPY --from=addin-build /app/outlook-addin/dist ./outlook-addin/dist
COPY index.html README.md ./

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

CMD ["node", "server/index.js"]

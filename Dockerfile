FROM node:26-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Dependabot PRs do not rewrite committed bundles. Always compile the image's
# assets from its own locked dependencies, without shipping development tools.
FROM node:26-alpine AS addin-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY scripts ./scripts
COPY outlook-addin ./outlook-addin
RUN npm run build:addin

FROM node:26-alpine AS runtime
WORKDIR /app

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

# Production builds pass an approved tag@sha256 digest through NODE_IMAGE.
ARG NODE_IMAGE=node:24.20.0-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/dist ./dist
COPY --from=build --chown=10001:10001 /app/package.json ./package.json
COPY --chown=10001:10001 knowledge ./knowledge
USER 10001:10001
# No EXPOSE or published host port is needed. Public ingress is tunnel-only.
HEALTHCHECK --interval=30s --timeout=6s --start-period=20s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:18080/v1/health',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "--max-old-space-size=320", "--max-http-header-size=8192", "dist/server.js"]

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY miniapp/api-server/package*.json ./
RUN npm ci
COPY miniapp/api-server/ ./
RUN npm run build && npm prune --omit=dev
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3002 FNS_DATA_DIR=/data/fns
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /data/sources && chown node:node /data/sources
USER node
EXPOSE 3002
CMD ["node", "dist/server.js"]

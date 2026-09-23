FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY chatbot/package*.json ./
RUN npm ci
COPY chatbot/ ./
RUN npm run build && npm prune --omit=dev
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/bot.js"]

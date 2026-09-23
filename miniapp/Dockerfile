FROM node:22-bookworm-slim AS build
WORKDIR /app/miniapp
COPY miniapp/package*.json ./
RUN npm ci
COPY miniapp/ ./
RUN npm run build
FROM nginx:1.28-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/miniapp/dist /usr/share/nginx/html
EXPOSE 80

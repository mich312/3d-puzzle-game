# THRESHOLD — single container: static client + WebSocket server + SQLite volume
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
VOLUME /app/data
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8080/api/health || exit 1
CMD ["npx", "tsx", "server/index.ts"]

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY sql ./sql
# SQLite lives on a named volume mounted at /data (see docker-compose.yml).
RUN mkdir -p /data && chown node:node /data
EXPOSE 4000
USER node
CMD ["node", "src/index.js"]

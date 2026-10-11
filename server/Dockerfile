FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY sql ./sql
# SQLite lives on a persistent volume mounted at /data (docker-compose volume, Railway Volume, ...).
RUN mkdir -p /data && chown node:node /data
# The entrypoint fixes ownership of the mounted data folder, then drops to the unprivileged "node" user
# before starting the app, so the Node process never runs as root. (sed strips CRs in case of Windows line endings.)
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && chmod 0755 /usr/local/bin/docker-entrypoint.sh
EXPOSE 4000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "src/index.js"]

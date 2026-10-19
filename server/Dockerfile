FROM node:22-alpine
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY server.js .
VOLUME /app/state
ENV DATA_FILE=/app/state/data.json KEYS_FILE=/app/state/vapid.json
EXPOSE 8787
CMD ["node", "server.js"]

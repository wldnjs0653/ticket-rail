FROM node:24.20.0-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV NODE_ENV=production
ENV HTTP_PORT=8083
EXPOSE 8083
USER node
CMD ["node", "src/index.js"]

# Build stage for the React frontend
FROM node:18-alpine AS frontend

WORKDIR /app

COPY package*.json ./
COPY tsconfig*.json ./
COPY vite.config.js ./
COPY src ./src
COPY public ./public

RUN npm install
RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig*.json ./
COPY server ./server
COPY --from=frontend /app/dist ./dist

RUN npm install --production

ENV PORT=3001
EXPOSE 3001

CMD ["node", "server/index.js"]

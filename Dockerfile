FROM node:20-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# Install dependencies first
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --omit=dev

# Copy source and build
COPY src ./src
RUN npm run build

# Runtime image
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/index.js"]

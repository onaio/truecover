# ABOUTME: Multi-stage Docker build for React app using Bun.
# ABOUTME: Produces an optimized nginx image serving the built frontend.

# Build stage
FROM oven/bun:alpine AS build

# Accept build arguments
ARG VITE_MAPBOX_TOKEN

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source files
COPY . .

# Build the React app with environment variables
ENV VITE_MAPBOX_TOKEN=${VITE_MAPBOX_TOKEN}
RUN bun run build

# Production stage
FROM nginx:alpine

# Copy built app from build stage
COPY --from=build /app/build /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

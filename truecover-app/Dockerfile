# Build stage
FROM node:18-alpine as build

# Accept build arguments
ARG REACT_APP_MAPBOX_TOKEN

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source files
COPY . .

# Build the React app with environment variables
ENV REACT_APP_MAPBOX_TOKEN=${REACT_APP_MAPBOX_TOKEN}
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built app from build stage
COPY --from=build /app/build /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

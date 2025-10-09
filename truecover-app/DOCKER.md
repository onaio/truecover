# TrueCover Docker Setup

This document explains how to run the TrueCover application in Docker.

## Architecture

The TrueCover app runs as a Dockerized web application that connects to backend services:

```
┌─────────────────────┐
│   TrueCover UI      │  (Port 3030)
│   (React + Nginx)   │
└──────────┬──────────┘
           │
           ├─ /api ────────────────> Adaptive Sampling (Port 8083)
           │
           └─ /api/prediction ────> Prevalence Predictor (Port 8081)
                                    └──> Covariate Extractor (Port 8082)
```

## Prerequisites

- Docker installed
- The following services running:
  - `disarm/fn-adaptive-sampling:0.3.1` on port 8083
  - `disarm/fn-prevalence-predictor:1.3.0` on port 8081
  - `disarm/fn-covariate-extractor:0.2.5` on port 8082

## Quick Start

### Option 1: Using the convenience script

```bash
./docker-run.sh
```

This will:
1. Build the Docker image
2. Stop any existing container
3. Start a new container on port 3030

### Option 2: Manual Docker commands

Build the image:
```bash
docker build -t truecover-ui:latest .
```

Run the container:
```bash
docker run -d \
  --name truecover-ui \
  -p 3030:80 \
  --add-host=host.docker.internal:host-gateway \
  truecover-ui:latest
```

### Option 3: Using docker-compose

```bash
docker-compose up -d
```

## Accessing the Application

Once running, access the application at:
- **TrueCover UI**: http://localhost:3030

## Docker Commands

### View logs
```bash
docker logs -f truecover-ui
```

### Stop the container
```bash
docker stop truecover-ui
```

### Restart the container
```bash
docker restart truecover-ui
```

### Remove the container
```bash
docker stop truecover-ui
docker rm truecover-ui
```

### Rebuild after code changes
```bash
docker stop truecover-ui
docker rm truecover-ui
docker build -t truecover-ui:latest .
docker run -d --name truecover-ui -p 3030:80 --add-host=host.docker.internal:host-gateway truecover-ui:latest
```

## How It Works

1. **Build Stage**:
   - Uses Node.js to install dependencies
   - Builds the React app with `npm run build`

2. **Production Stage**:
   - Uses Nginx Alpine for serving
   - Copies built React app to Nginx
   - Configures Nginx to proxy API requests to backend services

3. **Networking**:
   - Uses `host.docker.internal` to access services on the host machine
   - No CORS issues since everything goes through Nginx proxy

## Troubleshooting

### Container won't start
```bash
docker logs truecover-ui
```

### Can't connect to backend services
Ensure the backend Docker containers are running:
```bash
docker ps | grep "fn-"
```

### Port 3030 already in use
Change the port mapping:
```bash
docker run -d --name truecover-ui -p 8080:80 --add-host=host.docker.internal:host-gateway truecover-ui:latest
```

### Need to access from another machine
Update nginx.conf and rebuild:
```nginx
server_name _;  # Accept any hostname
```

## Configuration

### Nginx Configuration
The nginx.conf file controls:
- Static file serving
- API proxying
- Timeout settings
- Request size limits

Edit `nginx.conf` and rebuild the image to apply changes.

### Environment Variables
Currently no environment variables are needed. Backend service URLs are hardcoded in nginx.conf.

## Development vs Production

- **Development**: Use `npm start` with the proxy-server.js
- **Production**: Use this Docker setup

The Docker setup eliminates CORS issues and simplifies deployment.

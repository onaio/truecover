# TrueCover Kubernetes Deployment Guide

This document describes how to deploy TrueCover on Kubernetes for your DevOps team.

## Architecture Overview

```
                                    ┌─────────────────────────────────────────────────────────────┐
                                    │                     Kubernetes Cluster                       │
                                    │                                                              │
┌──────────┐     ┌─────────┐       │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
│  Users   │────▶│ Ingress │──────▶│  │  Frontend   │    │   Backend   │    │  Temporal   │      │
└──────────┘     └─────────┘       │  │   (nginx)   │───▶│    (API)    │───▶│   Worker    │      │
                                    │  └─────────────┘    └──────┬──────┘    └──────┬──────┘      │
                                    │                            │                   │            │
                                    │         ┌──────────────────┴───────────────────┘            │
                                    │         ▼                                                   │
                                    │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
                                    │  │  PostgreSQL │    │   Martin    │    │  Temporal   │      │
                                    │  │  + PostGIS  │◀───│ Tile Server │    │   Server    │      │
                                    │  └─────────────┘    └─────────────┘    └─────────────┘      │
                                    │                                                              │
                                    │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
                                    │  │  Adaptive   │    │ Prevalence  │    │  Covariate  │      │
                                    │  │  Sampling   │    │  Predictor  │    │  Extractor  │      │
                                    │  └─────────────┘    └─────────────┘    └─────────────┘      │
                                    │                                                              │
                                    └─────────────────────────────────────────────────────────────┘
```

## Components

| Component | Image | Port | Replicas | Notes |
|-----------|-------|------|----------|-------|
| Frontend | Custom (nginx) | 80 | 2+ | Stateless, can scale horizontally |
| Backend API | Custom (Python/Flask) | 5001 | 2+ | Stateless, can scale horizontally |
| Temporal Worker | Custom (Python) | N/A | 1-3 | Scale based on workflow load |
| PostgreSQL | postgis/postgis:15-3.3-alpine | 5432 | 1 | Stateful, use managed DB in production |
| Martin | ghcr.io/maplibre/martin:latest | 3000 | 2+ | Stateless, can scale horizontally |
| Temporal Server | temporalio/auto-setup:1.24.2 | 7233 | 1 | Consider Temporal Cloud for production |
| Temporal UI | temporalio/ui:latest | 8080 | 1 | Optional, for debugging |
| Adaptive Sampling | disarm/fn-adaptive-sampling:0.3.1 | 8080 | 1-2 | ML service |
| Prevalence Predictor | disarm/fn-prevalence-predictor:1.3.0 | 8080 | 1-2 | ML service |
| Covariate Extractor | disarm/fn-covariate-extractor:0.2.5 | 8080 | 1-2 | ML service |

## Prerequisites

- Kubernetes cluster (1.25+)
- kubectl configured
- Helm 3.x (optional, for charts)
- Container registry access (for custom images)
- Domain name and TLS certificates

## Container Images

### Images to Build

1. **truecover-frontend** - Already has Dockerfile at `truecover-app/Dockerfile`
2. **truecover-backend** - Needs Dockerfile (see ONA-2077)

### Pre-built Images (Pull from Registry)

- `postgis/postgis:15-3.3-alpine`
- `ghcr.io/maplibre/martin:latest`
- `temporalio/auto-setup:1.24.2`
- `temporalio/ui:latest`
- `disarm/fn-adaptive-sampling:0.3.1`
- `disarm/fn-prevalence-predictor:1.3.0`
- `disarm/fn-covariate-extractor:0.2.5`

## Namespace

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: truecover
```

## Secrets

### Database Credentials

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: postgres-credentials
  namespace: truecover
type: Opaque
stringData:
  POSTGRES_USER: truecover
  POSTGRES_PASSWORD: <generate-secure-password>
  POSTGRES_DB: truecover
  DATABASE_URL: postgresql://truecover:<password>@postgres:5432/truecover
```

### Clerk Authentication

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: clerk-credentials
  namespace: truecover
type: Opaque
stringData:
  CLERK_SECRET_KEY: <your-clerk-secret-key>
  VITE_CLERK_PUBLISHABLE_KEY: <your-clerk-publishable-key>
```

### Mapbox Token

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: mapbox-credentials
  namespace: truecover
type: Opaque
stringData:
  VITE_MAPBOX_TOKEN: <your-mapbox-token>
```

## ConfigMaps

### Backend Configuration

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: backend-config
  namespace: truecover
data:
  FLASK_ENV: production
  PORT: "5001"
  TEMPORAL_HOST: temporal:7233
  DOCKER_FN_PREVALENCE_URL: http://prevalence-predictor:8080
  DOCKER_FN_COVARIATE_URL: http://covariate-extractor:8080
  DOCKER_FN_SAMPLING_URL: http://adaptive-sampling:8080
```

### Frontend Configuration

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: frontend-config
  namespace: truecover
data:
  VITE_API_URL: https://api.your-domain.com
  VITE_MARTIN_URL: https://tiles.your-domain.com
```

### Martin Configuration

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: martin-config
  namespace: truecover
data:
  config.yaml: |
    postgres:
      connection_string: ${DATABASE_URL}
      auto_publish: true
      functions:
        pixels_by_area:
          schema: public
          function: pixels_by_area
          minzoom: 0
          maxzoom: 24
        locations_by_area:
          schema: public
          function: locations_by_area
          minzoom: 0
          maxzoom: 24
    pmtiles:
      paths: /pmtiles/
      sources:
        buildings:
          path: http://overturemaps-tiles-us-west-2-beta.s3.us-west-2.amazonaws.com/2025-10-22/buildings.pmtiles
```

## Persistent Volume Claims

### PostgreSQL Data

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-data
  namespace: truecover
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 50Gi
  storageClassName: standard  # Adjust based on your cluster
```

### PMTiles Storage (Optional - for local caching)

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: pmtiles-data
  namespace: truecover
spec:
  accessModes:
    - ReadOnlyMany  # Can be shared across Martin replicas
  resources:
    requests:
      storage: 100Gi
  storageClassName: standard
```

## Deployments

### PostgreSQL

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  namespace: truecover
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgis/postgis:15-3.3-alpine
          ports:
            - containerPort: 5432
          envFrom:
            - secretRef:
                name: postgres-credentials
          volumeMounts:
            - name: postgres-data
              mountPath: /var/lib/postgresql/data
          resources:
            requests:
              memory: "1Gi"
              cpu: "500m"
            limits:
              memory: "4Gi"
              cpu: "2000m"
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "truecover"]
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            exec:
              command: ["pg_isready", "-U", "truecover"]
            initialDelaySeconds: 30
            periodSeconds: 10
      volumes:
        - name: postgres-data
          persistentVolumeClaim:
            claimName: postgres-data
```

### Temporal Server

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: temporal
  namespace: truecover
spec:
  replicas: 1
  selector:
    matchLabels:
      app: temporal
  template:
    metadata:
      labels:
        app: temporal
    spec:
      containers:
        - name: temporal
          image: temporalio/auto-setup:1.24.2
          ports:
            - containerPort: 7233
          env:
            - name: DB
              value: postgres12
            - name: DB_PORT
              value: "5432"
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef:
                  name: postgres-credentials
                  key: POSTGRES_USER
            - name: POSTGRES_PWD
              valueFrom:
                secretKeyRef:
                  name: postgres-credentials
                  key: POSTGRES_PASSWORD
            - name: POSTGRES_SEEDS
              value: postgres
          resources:
            requests:
              memory: "512Mi"
              cpu: "250m"
            limits:
              memory: "2Gi"
              cpu: "1000m"
      initContainers:
        - name: wait-for-postgres
          image: busybox:1.36
          command: ['sh', '-c', 'until nc -z postgres 5432; do echo waiting for postgres; sleep 2; done']
```

### Temporal UI

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: temporal-ui
  namespace: truecover
spec:
  replicas: 1
  selector:
    matchLabels:
      app: temporal-ui
  template:
    metadata:
      labels:
        app: temporal-ui
    spec:
      containers:
        - name: temporal-ui
          image: temporalio/ui:latest
          ports:
            - containerPort: 8080
          env:
            - name: TEMPORAL_ADDRESS
              value: temporal:7233
            - name: TEMPORAL_CORS_ORIGINS
              value: http://localhost:3000
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
```

### Martin Tile Server

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: martin
  namespace: truecover
spec:
  replicas: 2
  selector:
    matchLabels:
      app: martin
  template:
    metadata:
      labels:
        app: martin
    spec:
      containers:
        - name: martin
          image: ghcr.io/maplibre/martin:latest
          ports:
            - containerPort: 3000
          args: ["--config", "/config/config.yaml"]
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: postgres-credentials
                  key: DATABASE_URL
          volumeMounts:
            - name: martin-config
              mountPath: /config
            - name: pmtiles-data
              mountPath: /pmtiles
              readOnly: true
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "1Gi"
              cpu: "500m"
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
      volumes:
        - name: martin-config
          configMap:
            name: martin-config
        - name: pmtiles-data
          persistentVolumeClaim:
            claimName: pmtiles-data
```

### Backend API

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: truecover
spec:
  replicas: 2
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
        - name: backend
          image: your-registry/truecover-backend:latest
          ports:
            - containerPort: 5001
          envFrom:
            - configMapRef:
                name: backend-config
            - secretRef:
                name: postgres-credentials
            - secretRef:
                name: clerk-credentials
          resources:
            requests:
              memory: "512Mi"
              cpu: "250m"
            limits:
              memory: "2Gi"
              cpu: "1000m"
          readinessProbe:
            httpGet:
              path: /health
              port: 5001
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /health
              port: 5001
            initialDelaySeconds: 30
            periodSeconds: 10
      initContainers:
        - name: wait-for-postgres
          image: busybox:1.36
          command: ['sh', '-c', 'until nc -z postgres 5432; do echo waiting for postgres; sleep 2; done']
```

### Temporal Worker

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: temporal-worker
  namespace: truecover
spec:
  replicas: 2
  selector:
    matchLabels:
      app: temporal-worker
  template:
    metadata:
      labels:
        app: temporal-worker
    spec:
      containers:
        - name: temporal-worker
          image: your-registry/truecover-backend:latest
          command: ["python", "temporal_worker.py"]
          envFrom:
            - configMapRef:
                name: backend-config
            - secretRef:
                name: postgres-credentials
          resources:
            requests:
              memory: "1Gi"
              cpu: "500m"
            limits:
              memory: "4Gi"
              cpu: "2000m"
      initContainers:
        - name: wait-for-temporal
          image: busybox:1.36
          command: ['sh', '-c', 'until nc -z temporal 7233; do echo waiting for temporal; sleep 2; done']
```

### Frontend

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: truecover
spec:
  replicas: 2
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
        - name: frontend
          image: your-registry/truecover-frontend:latest
          ports:
            - containerPort: 80
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          readinessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 10
```

### ML Services

```yaml
# Adaptive Sampling
apiVersion: apps/v1
kind: Deployment
metadata:
  name: adaptive-sampling
  namespace: truecover
spec:
  replicas: 1
  selector:
    matchLabels:
      app: adaptive-sampling
  template:
    metadata:
      labels:
        app: adaptive-sampling
    spec:
      containers:
        - name: adaptive-sampling
          image: disarm/fn-adaptive-sampling:0.3.1
          ports:
            - containerPort: 8080
          env:
            - name: exec_timeout
              value: "300"
            - name: read_timeout
              value: "300"
            - name: write_timeout
              value: "300"
          resources:
            requests:
              memory: "512Mi"
              cpu: "250m"
            limits:
              memory: "2Gi"
              cpu: "1000m"
---
# Prevalence Predictor
apiVersion: apps/v1
kind: Deployment
metadata:
  name: prevalence-predictor
  namespace: truecover
spec:
  replicas: 1
  selector:
    matchLabels:
      app: prevalence-predictor
  template:
    metadata:
      labels:
        app: prevalence-predictor
    spec:
      containers:
        - name: prevalence-predictor
          image: disarm/fn-prevalence-predictor:1.3.0
          ports:
            - containerPort: 8080
          env:
            - name: exec_timeout
              value: "910"
          resources:
            requests:
              memory: "1Gi"
              cpu: "500m"
            limits:
              memory: "4Gi"
              cpu: "2000m"
---
# Covariate Extractor
apiVersion: apps/v1
kind: Deployment
metadata:
  name: covariate-extractor
  namespace: truecover
spec:
  replicas: 1
  selector:
    matchLabels:
      app: covariate-extractor
  template:
    metadata:
      labels:
        app: covariate-extractor
    spec:
      containers:
        - name: covariate-extractor
          image: disarm/fn-covariate-extractor:0.2.5
          ports:
            - containerPort: 8080
          resources:
            requests:
              memory: "512Mi"
              cpu: "250m"
            limits:
              memory: "2Gi"
              cpu: "1000m"
```

## Services

```yaml
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: truecover
spec:
  selector:
    app: postgres
  ports:
    - port: 5432
      targetPort: 5432
  type: ClusterIP
---
apiVersion: v1
kind: Service
metadata:
  name: temporal
  namespace: truecover
spec:
  selector:
    app: temporal
  ports:
    - port: 7233
      targetPort: 7233
  type: ClusterIP
---
apiVersion: v1
kind: Service
metadata:
  name: temporal-ui
  namespace: truecover
spec:
  selector:
    app: temporal-ui
  ports:
    - port: 8080
      targetPort: 8080
  type: ClusterIP
---
apiVersion: v1
kind: Service
metadata:
  name: martin
  namespace: truecover
spec:
  selector:
    app: martin
  ports:
    - port: 3000
      targetPort: 3000
  type: ClusterIP
---
apiVersion: v1
kind: Service
metadata:
  name: backend
  namespace: truecover
spec:
  selector:
    app: backend
  ports:
    - port: 5001
      targetPort: 5001
  type: ClusterIP
---
apiVersion: v1
kind: Service
metadata:
  name: frontend
  namespace: truecover
spec:
  selector:
    app: frontend
  ports:
    - port: 80
      targetPort: 80
  type: ClusterIP
---
apiVersion: v1
kind: Service
metadata:
  name: adaptive-sampling
  namespace: truecover
spec:
  selector:
    app: adaptive-sampling
  ports:
    - port: 8080
      targetPort: 8080
  type: ClusterIP
---
apiVersion: v1
kind: Service
metadata:
  name: prevalence-predictor
  namespace: truecover
spec:
  selector:
    app: prevalence-predictor
  ports:
    - port: 8080
      targetPort: 8080
  type: ClusterIP
---
apiVersion: v1
kind: Service
metadata:
  name: covariate-extractor
  namespace: truecover
spec:
  selector:
    app: covariate-extractor
  ports:
    - port: 8080
      targetPort: 8080
  type: ClusterIP
```

## Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: truecover-ingress
  namespace: truecover
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
spec:
  tls:
    - hosts:
        - app.your-domain.com
        - api.your-domain.com
        - tiles.your-domain.com
      secretName: truecover-tls
  rules:
    - host: app.your-domain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port:
                  number: 80
    - host: api.your-domain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: backend
                port:
                  number: 5001
    - host: tiles.your-domain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: martin
                port:
                  number: 3000
```

## Startup Order

Services must start in this order due to dependencies:

1. **PostgreSQL** - Database must be ready first
2. **Temporal Server** - Depends on PostgreSQL
3. **Martin** - Depends on PostgreSQL
4. **Backend API** - Depends on PostgreSQL
5. **Temporal Worker** - Depends on Temporal Server and PostgreSQL
6. **ML Services** - Can start independently
7. **Frontend** - Can start independently (but needs backend for full functionality)
8. **Temporal UI** - Depends on Temporal Server

The init containers in the deployment specs handle this ordering automatically.

## Scaling Considerations

### Horizontal Scaling (Safe to Scale)

- **Frontend**: Stateless, scale based on traffic
- **Backend API**: Stateless, scale based on API load
- **Martin**: Stateless, scale based on tile request load
- **Temporal Worker**: Scale based on workflow queue depth
- **ML Services**: Scale based on prediction request load

### Single Instance (Do Not Scale Without Consideration)

- **PostgreSQL**: Use managed database (RDS, Cloud SQL) for HA instead
- **Temporal Server**: Consider Temporal Cloud for production, or run in cluster mode

## Production Recommendations

### Database

Use a managed PostgreSQL service with PostGIS extension:
- AWS: RDS PostgreSQL with PostGIS
- GCP: Cloud SQL PostgreSQL
- Azure: Azure Database for PostgreSQL

### Temporal

Consider [Temporal Cloud](https://temporal.io/cloud) for production workloads instead of self-hosting.

### Secrets Management

Use a secrets manager instead of Kubernetes Secrets:
- AWS Secrets Manager + External Secrets Operator
- HashiCorp Vault
- GCP Secret Manager

### PMTiles Storage

For production, consider:
- S3/GCS bucket with public read access for PMTiles
- CDN in front of tile server
- Martin can read PMTiles directly from HTTP URLs (already configured for Overture buildings)

### Monitoring

Add monitoring with:
- Prometheus for metrics collection
- Grafana for dashboards
- Alert manager for notifications

Expose metrics endpoints:
- Backend: Add `/metrics` endpoint
- Temporal: Has built-in metrics support
- PostgreSQL: Use postgres_exporter

### Resource Tuning

The resource requests/limits in this document are starting points. Monitor actual usage and adjust:

```bash
kubectl top pods -n truecover
```

## Environment-Specific Configurations

### Development/Staging

- Use smaller resource requests
- Single replica for most services
- Use in-cluster PostgreSQL
- Self-hosted Temporal

### Production

- Managed PostgreSQL with read replicas
- Temporal Cloud or HA Temporal cluster
- Multiple replicas for stateless services
- CDN for frontend and tiles
- Proper backup strategies for PostgreSQL

## Deployment Commands

```bash
# Create namespace
kubectl apply -f namespace.yaml

# Apply secrets (ensure you've filled in real values)
kubectl apply -f secrets/

# Apply ConfigMaps
kubectl apply -f configmaps/

# Apply PVCs
kubectl apply -f pvcs/

# Deploy services in order
kubectl apply -f deployments/postgres.yaml
kubectl wait --for=condition=ready pod -l app=postgres -n truecover --timeout=120s

kubectl apply -f deployments/temporal.yaml
kubectl wait --for=condition=ready pod -l app=temporal -n truecover --timeout=120s

kubectl apply -f deployments/martin.yaml
kubectl apply -f deployments/backend.yaml
kubectl apply -f deployments/temporal-worker.yaml
kubectl apply -f deployments/ml-services.yaml
kubectl apply -f deployments/frontend.yaml
kubectl apply -f deployments/temporal-ui.yaml

# Apply services
kubectl apply -f services/

# Apply ingress
kubectl apply -f ingress.yaml
```

## Troubleshooting

### Check pod status

```bash
kubectl get pods -n truecover
kubectl describe pod <pod-name> -n truecover
kubectl logs <pod-name> -n truecover
```

### Check service connectivity

```bash
kubectl run -it --rm debug --image=busybox -n truecover -- sh
# Then from inside:
nc -zv postgres 5432
nc -zv temporal 7233
```

### Database migrations

The backend runs migrations on startup. If needed manually:

```bash
kubectl exec -it deployment/backend -n truecover -- python -c "from db.migrations import run_migrations; run_migrations()"
```

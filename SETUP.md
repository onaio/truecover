# TrueCover Multi-Tenant Setup Guide

This guide walks you through setting up the TrueCover application with Clerk authentication and PostgreSQL multi-tenancy.

## Architecture

```
Frontend (React + Clerk)
    ↓ (authenticated requests)
Backend (Flask + Clerk verification)
    ↓ (user data)
PostgreSQL Database
    ↓ (proxy requests)
Docker Functions (adaptive-sampling, prevalence-predictor, covariate-extractor)
```

## Prerequisites

- Docker Desktop installed and running
- Python 3.9+
- Node.js 16+
- PostgreSQL (via Docker)

## Step-by-Step Setup

### 1. Start PostgreSQL Database

```bash
cd truecover-backend
docker-compose up -d
```

Verify PostgreSQL is running:
```bash
docker ps | grep truecover-postgres
```

### 2. Setup Backend (Flask)

```bash
cd truecover-backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# The .env file is already configured with Clerk keys
# Run migrations (or they'll run automatically on app start)
python -m db.migrations

# Start Flask server
python app.py
```

The backend API will be available at http://localhost:5000

### 3. Start Docker Functions

In a new terminal:

```bash
# Start all three functions
docker run -d -p 8081:8080 -e exec_timeout=910 disarm/fn-prevalence-predictor:1.3.0
docker run -d -p 8082:8080 -e exec_timeout=600 disarm/fn-covariate-extractor:0.2.5
docker run -d -p 8083:8080 -e exec_timeout=60 disarm/fn-adaptive-sampling:0.3.1
```

Verify functions are running:
```bash
curl http://localhost:8081
curl http://localhost:8082
curl http://localhost:8083
```

### 4. Setup Frontend (React)

In a new terminal:

```bash
cd truecover-app

# Install dependencies (if not already done)
npm install

# The .env file is already configured with Clerk publishable key

# Start React app
npm start
```

The app will open at http://localhost:3050

## Testing the Authentication Flow

### 1. Access the App

Navigate to http://localhost:3050

You should see the Clerk sign-in page.

### 2. Create a Test Account

Click "Sign up" and create a test account with:
- Email
- Password

Clerk will handle the authentication.

### 3. Verify User Sync

Once signed in, check that the user was synced to the database:

```bash
# Connect to PostgreSQL
docker exec -it truecover-postgres psql -U truecover -d truecover

# Query users
SELECT * FROM users;
```

You should see your user with:
- `id` (UUID - internal)
- `clerk_id` (Clerk's user ID)
- `email`
- `name`
- `organization`

### 4. Test API Calls

Try uploading a file and running adaptive sampling. The frontend will:
1. Get an auth token from Clerk
2. Send the request to Flask backend with `Authorization: Bearer <token>`
3. Flask verifies the token and syncs the user
4. Flask proxies the request to the Docker function
5. Results are returned to the frontend

### 5. Check Backend Logs

In the Flask terminal, you should see:
```
Authentication successful for user: <clerk_id>
User synced to database: <email>
Proxying request to adaptive sampling function...
```

## Troubleshooting

### Frontend Issues

**Problem**: "Missing Clerk Publishable Key" error
**Solution**: Make sure `.env` file exists in `truecover-app` with `REACT_APP_CLERK_PUBLISHABLE_KEY`

**Problem**: 401 Authentication errors
**Solution**:
- Check that Flask backend is running
- Check browser console for auth token
- Verify Clerk keys match between frontend and backend

### Backend Issues

**Problem**: "Could not connect to database"
**Solution**:
```bash
cd truecover-backend
docker-compose ps
# If not running:
docker-compose up -d
```

**Problem**: "Invalid token" errors
**Solution**: Verify `CLERK_SECRET_KEY` in `truecover-backend/.env` matches your Clerk dashboard

### Docker Function Issues

**Problem**: Docker functions not responding
**Solution**:
```bash
# Check if containers are running
docker ps | grep disarm

# Check logs
docker logs <container_id>

# Restart if needed
docker stop <container_id>
docker rm <container_id>
# Then re-run the docker run command
```

## Environment Variables Summary

### Frontend (`truecover-app/.env`)
```env
PORT=3050
REACT_APP_MAPBOX_TOKEN=<your_mapbox_token>
REACT_APP_CLERK_PUBLISHABLE_KEY=pk_test_YnJhdmUtY2FyZGluYWwtMzEuY2xlcmsuYWNjb3VudHMuZGV2JA
REACT_APP_API_URL=http://localhost:5000
```

### Backend (`truecover-backend/.env`)
```env
CLERK_SECRET_KEY=sk_test_IhxH4FtiRDV9KlEvfCPO3PUxsD8eOoNvgBRYz5ch89
DATABASE_URL=postgresql://truecover:truecover@localhost:5432/truecover
DOCKER_FN_PREVALENCE_URL=http://localhost:8081
DOCKER_FN_COVARIATE_URL=http://localhost:8082
DOCKER_FN_SAMPLING_URL=http://localhost:8083
FLASK_ENV=development
PORT=5000
```

## Next Steps

Now that authentication is working, you can:

1. **Add project management**: Create tables for projects, datasets, and analysis runs
2. **Save analysis results**: Store results in PostgreSQL instead of just in-memory
3. **User profiles**: Allow users to update their name and organization
4. **Access control**: Ensure users can only see their own data

## Current Database Schema

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  organization TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## API Endpoints

### Public
- `GET /` - API documentation
- `GET /health` - Health check

### Authenticated (requires Clerk token)
- `GET /api/user/me` - Get current user
- `PUT /api/user/me` - Update user profile
- `POST /api/sampling` - Adaptive sampling
- `POST /api/prediction` - Coverage prediction
- `POST /api/covariate` - Covariate extraction

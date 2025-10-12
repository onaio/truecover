# TrueCover Backend API

Flask-based backend API for TrueCover with Clerk authentication and PostgreSQL.

## Setup

### 1. Install Python Dependencies

```bash
cd truecover-backend
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Start PostgreSQL

```bash
docker-compose up -d
```

This will start PostgreSQL on port 5432.

### 3. Configure Environment

Copy `.env.example` to `.env` and update with your values:

```bash
cp .env.example .env
```

The `.env` file is already configured with the provided Clerk keys.

### 4. Run Database Migrations

Migrations run automatically on app startup, or you can run manually:

```bash
python -m db.migrations
```

### 5. Start the Flask Server

```bash
python app.py
```

The API will be available at http://localhost:5000

## API Endpoints

### Public Endpoints

- `GET /` - API documentation
- `GET /health` - Health check

### Authenticated Endpoints (require Clerk token)

#### User Management
- `GET /api/user/me` - Get current user information
- `PUT /api/user/me` - Update user profile (name, organization)

#### Function Proxies
- `POST /api/sampling` - Adaptive sampling (proxies to Docker function)
- `POST /api/prediction` - Prevalence prediction (proxies to Docker function)
- `POST /api/covariate` - Covariate extraction (proxies to Docker function)

## Authentication

All `/api/*` endpoints (except health checks) require a valid Clerk JWT token in the Authorization header:

```
Authorization: Bearer <clerk_token>
```

The backend will:
1. Verify the token with Clerk
2. Sync the user to the local database
3. Attach user info to the request

## Database Schema

### Users Table

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

## Development

### Running Tests

```bash
# TODO: Add tests
pytest
```

### Database Management

```bash
# Connect to PostgreSQL
docker exec -it truecover-postgres psql -U truecover -d truecover

# View users
SELECT * FROM users;

# Stop PostgreSQL
docker-compose down

# Stop and remove data
docker-compose down -v
```

## Production Deployment

Use gunicorn for production:

```bash
gunicorn -w 4 -b 0.0.0.0:5000 app:app
```

Or use the included Docker Compose configuration.

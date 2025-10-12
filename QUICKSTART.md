# TrueCover Authentication - Quick Start Guide

## Current Status

All services are UP and RUNNING! 🎉

- ✅ PostgreSQL Database: Running on port 5432
- ✅ Flask Backend API: Running on port 5001
- ✅ React Frontend: Running on port 3050

## Test the Application NOW

### 1. Open the App

Navigate to: **http://localhost:3050**

You should see the Clerk sign-in page with the TrueCover header.

### 2. Create an Account

1. Click "Sign up" on the Clerk form
2. Enter your email and create a password
3. Clerk will send a verification email (check spam folder)
4. Verify your email
5. You'll be automatically signed in

**OR use the "Sign in" tab if you already have an account**

### 3. Verify You're Signed In

Once signed in, you should see:
- The main TrueCover interface
- A user button in the top-right corner (click it to see your profile/sign out)
- Two workflow options: "Adaptive Sampling" and "Coverage Prediction"

### 4. Check Your User in the Database

Open a new terminal and run:

```bash
docker exec -it truecover-postgres psql -U truecover -d truecover -c "SELECT id, clerk_id, email, name, organization, created_at FROM users;"
```

You should see your user record with:
- A UUID for `id`
- Your Clerk user ID
- Your email
- Name (if you set it in Clerk)
- Organization (null for now)
- Creation timestamp

### 5. Test the API

Try using the app:
1. Click "Adaptive Sampling"
2. Upload a GeoJSON file (you can use one from the `data/` directory)
3. Configure the sampling parameters
4. Click "Run Adaptive Sampling"

Watch the Flask backend terminal logs - you should see:
- Token verification
- User sync
- Request proxy to Docker function

**Note:** You need to start the Docker functions for this to work fully:

```bash
docker run -d -p 8081:8080 -e exec_timeout=910 disarm/fn-prevalence-predictor:1.3.0
docker run -d -p 8082:8080 -e exec_timeout=600 disarm/fn-covariate-extractor:0.2.5
docker run -d -p 8083:8080 -e exec_timeout=60 disarm/fn-adaptive-sampling:0.3.1
```

## Stopping Services

### Stop Flask Backend
In the terminal where Flask is running, press `Ctrl+C`

OR find and kill the process:
```bash
lsof -i :5001  # Find the PID
kill <PID>     # Replace with actual PID
```

### Stop PostgreSQL
```bash
cd truecover-backend
docker-compose down
```

### Stop React App
In the terminal where React is running, press `Ctrl+C`

### Stop Docker Functions
```bash
docker ps | grep disarm  # See running containers
docker stop <container_id>  # Stop each one
```

## Restarting Services

### Start PostgreSQL
```bash
cd truecover-backend
docker-compose up -d
```

### Start Flask Backend
```bash
cd truecover-backend
source venv/bin/activate
python app.py
```

### Start React Frontend
```bash
cd truecover-app
npm start
```

### Start Docker Functions
```bash
docker run -d -p 8081:8080 -e exec_timeout=910 disarm/fn-prevalence-predictor:1.3.0
docker run -d -p 8082:8080 -e exec_timeout=600 disarm/fn-covariate-extractor:0.2.5
docker run -d -p 8083:8080 -e exec_timeout=60 disarm/fn-adaptive-sampling:0.3.1
```

## Common Issues

### "Missing Clerk Publishable Key"
- Make sure `truecover-app/.env` exists
- Restart the React dev server: Stop it and run `npm start` again

### 401 Authentication Errors
- Check that Flask backend is running: `curl http://localhost:5001/health`
- Sign out and sign back in to get a fresh token
- Check browser console for error details

### Database Connection Errors
- Verify PostgreSQL is running: `docker ps | grep postgres`
- Check the connection string in `truecover-backend/.env`

### Port Already in Use
- Flask (5001): Change `PORT` in `truecover-backend/.env`
- React (3050): Change `PORT` in `truecover-app/.env`
- PostgreSQL (5432): Change port mapping in `docker-compose.yml`

## What's Working

✅ User sign-up and sign-in with Clerk
✅ Automatic user sync to PostgreSQL database
✅ Protected API endpoints
✅ JWT token verification
✅ User profile management
✅ Database connection pooling
✅ API proxy to Docker functions (when they're running)

## Next Steps

1. **Test the sign-in flow** - Create an account and sign in
2. **Verify database sync** - Check that your user appears in PostgreSQL
3. **Try the workflows** - Upload files and test adaptive sampling
4. **Update your profile** - Use the API to update name/organization
5. **Build project features** - Add project management tables and UI
6. **Add data persistence** - Store analysis results in the database

## API Endpoints You Can Test

### Get Current User
```bash
# Get your auth token from the browser (inspect -> Application -> Local Storage -> Clerk)
curl -H "Authorization: Bearer <your_token>" http://localhost:5001/api/user/me
```

### Update Your Profile
```bash
curl -X PUT http://localhost:5001/api/user/me \
  -H "Authorization: Bearer <your_token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Your Name", "organization": "Your Org"}'
```

### Health Check (No Auth Required)
```bash
curl http://localhost:5001/health
```

## Documentation Files

- `SETUP.md` - Detailed setup instructions
- `AUTHENTICATION_IMPLEMENTATION.md` - Complete implementation details
- `QUICKSTART.md` - This file
- `truecover-backend/README.md` - Backend-specific docs
- `README.md` - Original project documentation

## You're All Set! 🚀

Everything is configured and running. Just open http://localhost:3050 and start testing!

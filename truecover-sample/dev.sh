#!/bin/bash

echo "TrueCover Development Mode"
echo "=========================="
echo ""
echo "This will start the app with hot reload for development."
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    echo ""
fi

# Create dev-proxy.js if it doesn't exist
if [ ! -f "dev-proxy.js" ]; then
    echo "Creating dev-proxy.js..."
    cat > dev-proxy.js << 'EOF'
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.post('/api', async (req, res) => {
  try {
    const response = await axios.post('http://localhost:8083', req.body, {
      headers: { 'Content-Type': 'application/json' }
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      message: error.message
    });
  }
});

app.post('/api/prediction', async (req, res) => {
  try {
    const response = await axios.post('http://localhost:8081', req.body, {
      headers: { 'Content-Type': 'application/json' }
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      message: error.message
    });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log('\x1b[32m✓\x1b[0m Dev proxy running on http://localhost:3001');
  console.log('\x1b[32m✓\x1b[0m Forwarding /api to http://localhost:8083 (adaptive sampling)');
  console.log('\x1b[32m✓\x1b[0m Forwarding /api/prediction to http://localhost:8081 (coverage prediction)');
});
EOF
    echo "✓ Created dev-proxy.js"
    echo ""
fi

# Check if backend services are running
echo "Checking backend services..."
SERVICES_RUNNING=true

if ! docker ps | grep -q "8083.*8080"; then
    echo "⚠ Adaptive sampling service not found on port 8083"
    SERVICES_RUNNING=false
fi

if ! docker ps | grep -q "8081.*8080"; then
    echo "⚠ Prevalence predictor service not found on port 8081"
    SERVICES_RUNNING=false
fi

if ! docker ps | grep -q "8082.*8080"; then
    echo "⚠ Covariate extractor service not found on port 8082"
    SERVICES_RUNNING=false
fi

if [ "$SERVICES_RUNNING" = false ]; then
    echo ""
    echo "Some backend services are not running. Start them with:"
    echo "  docker run -d --name adaptive-sampling -p 8083:8080 disarm/fn-adaptive-sampling:0.3.1"
    echo "  docker run -d --name prevalence-predictor -p 8081:8080 -e exec_timeout=910 disarm/fn-prevalence-predictor:1.3.0"
    echo "  docker run -d --name covariate-extractor -p 8082:8080 disarm/fn-covariate-extractor:0.2.5"
    echo ""
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo "✓ All backend services are running"
fi

echo ""
echo "Starting development servers..."
echo ""
echo "Access the app at: http://localhost:3003"
echo "Press Ctrl+C to stop"
echo ""

# Start proxy in background
node dev-proxy.js &
PROXY_PID=$!

# Wait a moment for proxy to start
sleep 1

# Start React dev server
npm start

# Cleanup: kill proxy when React dev server exits
kill $PROXY_PID 2>/dev/null

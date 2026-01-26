#!/bin/sh
# Docker entrypoint script for runtime environment configuration
# Generates env-config.js with environment variables at container startup

# Create env-config.js with runtime environment variables
cat > /usr/share/nginx/html/env-config.js << EOF
// Runtime environment configuration - generated at container startup
window.__ENV__ = {
  VITE_API_URL: "${VITE_API_URL:-}",
  VITE_MARTIN_URL: "${VITE_MARTIN_URL:-}",
  VITE_MAPBOX_TOKEN: "${VITE_MAPBOX_TOKEN:-}",
  VITE_CLERK_PUBLISHABLE_KEY: "${VITE_CLERK_PUBLISHABLE_KEY:-}"
};
EOF

echo "Generated /usr/share/nginx/html/env-config.js with runtime config"

# Start nginx
exec nginx -g 'daemon off;'

// Runtime environment configuration with fallback to build-time values
// This allows environment variables to be injected at container startup
// via env-config.js, while still working in development with Vite's import.meta.env

declare global {
  interface Window {
    __ENV__?: {
      VITE_API_URL?: string;
      VITE_MARTIN_URL?: string;
      VITE_MAPBOX_TOKEN?: string;
      VITE_CLERK_PUBLISHABLE_KEY?: string;
    };
  }
}

// Helper to get env value with runtime override support
// Uses explicit undefined/null checks so empty strings are valid values
const getEnv = (key: string, fallback: string = ''): string => {
  // First check runtime config (injected by docker-entrypoint.sh)
  const runtimeValue = window.__ENV__?.[key as keyof typeof window.__ENV__];
  if (runtimeValue !== undefined && runtimeValue !== null) {
    return runtimeValue;
  }

  // Fall back to build-time Vite env
  const buildValue = import.meta.env[key];
  if (buildValue !== undefined && buildValue !== null) {
    return buildValue;
  }

  // Return fallback
  return fallback;
};

export const env = {
  VITE_API_URL: getEnv('VITE_API_URL', 'http://localhost:5001'),
  VITE_MARTIN_URL: getEnv('VITE_MARTIN_URL', 'http://localhost:3052'),
  VITE_MAPBOX_TOKEN: getEnv('VITE_MAPBOX_TOKEN', ''),
  VITE_CLERK_PUBLISHABLE_KEY: getEnv('VITE_CLERK_PUBLISHABLE_KEY', ''),
};

export default env;

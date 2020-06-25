import queryString from 'query-string';
import config from '@/config/config';

const STORAGE_KEY = config.api.localStorage_key;

// Check for an api_key in the URL, otherwise use the default
export function set_api_key(): void {
  config.api.key = get_api_key();
}

function get_api_key(): null | string {
  const query_api_key = queryString.parse(location.search)[STORAGE_KEY];

  // Cascade through options to find api_key
  const api_key = query_api_key
    || process.env.VUE_APP_API_KEY
    || config.api.key;

  return api_key;
}

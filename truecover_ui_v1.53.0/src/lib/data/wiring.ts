import { RunResponse, RunRequest } from '@/types';
import config from '@/config/config';

async function invoke_run(run_request: RunRequest): Promise<RunResponse> {
  if (!config.api.key) {
    throw new Error('Missing API key');
  }

  const function_name = run_request.algo.fn_name;

  const headers = {
    'Content-Type': 'application/json',
    'api_key': config.api.key,
    'function_name': function_name,
  };

  const opts: RequestInit = {
    method: 'POST',
    body: JSON.stringify(run_request.params),
    mode: 'cors',
    headers,
  };

  let res_clone; // In case res.json() fails later, body can be re-read

  try {
    const res = await fetch(config.api.url, opts);
    res_clone = res.clone();
    const json = await res.json();
    const result_headers = await res.headers;
    if ([200, 401].includes(res.status)) {
      return {
        headers: result_headers,
        ...json,
        finished_at: new Date(),
      };
    } else {
      // Something broke on API server
      return {
        function_status: 'unknown',
        result: {
          ...headers,
          ...json,
        },
        finished_at: new Date(),
      };
    }
  } catch (err) {
    // Most likely a problem parsing the `res` as JSON
    if (err.name === 'SyntaxError' && res_clone) {
      return await {
        function_status: 'unknown',
        result: res_clone.text(),
        finished_at: new Date(),
      };
    }
    return {
      function_status: 'error',
      result: err.toString(),
      finished_at: new Date(),
    };
  }
}
export {
  invoke_run,
};

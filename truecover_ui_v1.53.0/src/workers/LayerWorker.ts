import { generate_viz } from '@/lib/viz/generate_viz';

const ctx: Worker = self as any;

// Respond to message from parent thread
ctx.addEventListener('message', (event) => {
  const result = generate_viz(event.data);
  ctx.postMessage(result);
});


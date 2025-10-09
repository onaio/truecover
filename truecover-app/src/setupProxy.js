const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // Proxy prediction requests to prevalence predictor
  app.use(
    '/api/prediction',
    createProxyMiddleware({
      target: 'http://localhost:8084',
      changeOrigin: true,
      pathRewrite: {
        '^/api/prediction': '/',
      },
      logLevel: 'debug',
    })
  );

  // Proxy other API requests to adaptive sampling
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:8083',
      changeOrigin: true,
      pathRewrite: {
        '^/api': '/',
      },
      logLevel: 'debug',
    })
  );
};

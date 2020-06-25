const webpack = require('webpack');

const commit_hash = require('child_process')
  .execSync('git rev-parse --short HEAD | tr -d "\n"')
  .toString();

module.exports = {
  pluginOptions: {
    quasar: {
      treeShake: true,
    }
  },
  transpileDependencies: [
    /[\\\/]node_modules[\\\/]quasar[\\\/]/
  ],
  configureWebpack: config => {
    return {
      plugins: [
        new webpack.DefinePlugin({
          APPLICATION_VERSION: JSON.stringify(require('./package.json').version),
          COMMIT_HASH: JSON.stringify(commit_hash),
          // Set by Netlify (see https://docs.netlify.com/site-deploys/overview/#deploy-contexts)
          CONTEXT: JSON.stringify(process.env.CONTEXT) 
        }),
      ]
    };
  },
}

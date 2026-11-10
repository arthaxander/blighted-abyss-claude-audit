// Match CRA's source transform for reproducible offline map audits.
process.env.NODE_ENV = 'test';
process.env.BABEL_ENV = 'test';
const path = require('path');
const root = path.resolve(__dirname, '..');
const babel = require('@babel/core');
const original = require.extensions['.js'];
require.extensions['.js'] = (module, filename) => {
  if (!filename.startsWith(root + '/src/')) return original(module, filename);
  const { code } = babel.transformFileSync(filename, {
    babelrc: false, configFile: false,
    presets: [require.resolve('babel-preset-react-app')], sourceMaps: false,
  });
  module._compile(code, filename);
};

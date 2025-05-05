// See: https://rollupjs.org/introduction/

import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';

const config = {
  input: 'src/index.ts',
  output: {
    esModule: true,
    file: 'dist/index.js',
    format: 'es',
    sourcemap: true,
  },
  plugins: [json(), typescript(), nodeResolve({ preferBuiltins: true }), commonjs()],
  onwarn(warning, warn) {
    if (warning.code === 'CIRCULAR_DEPENDENCY') return; // ✅ Suppress safe circular deps
    warn(warning);
  },
};

export default config;

import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

/**
 * Template config must come after `baseConfig` so HTML files keep the Angular template parser.
 */
export default [
  ...nx.configs['flat/angular'],
  ...baseConfig,
  ...nx.configs['flat/angular-template'],
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    rules: {},
  },
];

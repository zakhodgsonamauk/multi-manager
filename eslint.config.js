// eslint.config.js
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // .claude-plugin/types/ is the plugin API declaration Claude Code writes beside the plugin when it loads it
  // (generated, not ours to lint). The mod's own files (hooks/*.tsx, mod-test/) are linted here like the rest;
  // they are type-checked by `npm run check:mod`, since they compile against that API and not against Node.
  { ignores: ['node_modules/**', 'conductor/**', '.claude/**', '.claude-plugin/types/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
);

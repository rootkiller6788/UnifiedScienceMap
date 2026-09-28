import globals from "globals";
import pluginJs from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  // Configuration for browser-specific files
  {
    files: ["src/js/**/*.js"], // Browser-related files
    languageOptions: {
      globals: {
        ...globals.browser, // Enable browser globals like `document` and `window`
      },
    },
  },
  // Configuration for Node.js-specific files
  {
    files: ["**/*.config.js", "plugins/**/*.js"], // Node.js-related files
    languageOptions: {
      globals: {
        ...globals.node, // Enable Node.js globals like `require` and `__dirname`
      },
    },
  },
  // Base recommended ESLint configuration
  pluginJs.configs.recommended,
  // Disable Prettier conflicts
  eslintConfigPrettier,
];

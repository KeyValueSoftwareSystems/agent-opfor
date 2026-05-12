import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    ignores: [
      "dist/",
      "node_modules/",
      "core/dist/",
      "cli/dist/",
      "mcp/dist/",
      "src/agent/**/dist/",
      "extension/catalog.json",
      ".opfor/",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["extension/scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
  {
    files: ["extension/**/*.js"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        fetch: "readonly",
        console: "readonly",
        CSS: "readonly",
        Element: "readonly",
        HTMLElement: "readonly",
        HTMLButtonElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLTextAreaElement: "readonly",
        HTMLSelectElement: "readonly",
        HTMLAnchorElement: "readonly",
        InputEvent: "readonly",
        KeyboardEvent: "readonly",
        MouseEvent: "readonly",
        Event: "readonly",
        MutationObserver: "readonly",
        chrome: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        Promise: "readonly",
        AbortController: "readonly",
        requestAnimationFrame: "readonly",
        process: "readonly",
        Buffer: "readonly",
      },
    },
    rules: {
      "no-undef": "off",
      "no-empty": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  }
);

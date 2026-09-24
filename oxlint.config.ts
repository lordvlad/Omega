import { defineConfig } from "oxlint";
import { oxlint } from "oxc-config-mantine";

export default defineConfig({
  extends: [oxlint],
  rules: {
    ...oxlint.rules,
    radix: "off",
    "no-unused-vars": [
      "error",
      {
        args: "all",
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrors: "none",
        ignoreRestSiblings: true,
      },
    ],
    "typescript/no-unused-vars": [
      "error",
      {
        args: "all",
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrors: "none",
        ignoreRestSiblings: true,
      },
    ],
    "no-console": "off",
    "no-alert": "off",
    "no-duplicate-imports": "off",
    "no-lonely-if": "off",
    "jsx-a11y/click-events-have-key-events": "off",
    "jsx-a11y/no-static-element-interactions": "off",
    "jsx-a11y/media-has-caption": "off",
    "jsx-a11y/interactive-supports-focus": "off",
    "jsx-a11y/no-noninteractive-element-interactions": "off",
  },
  ignorePatterns: [
    "**/*.{mjs,cjs,js,d.ts,d.mts}",
    "node_modules/**",
    "dist/**",
    "src/client/api/**",
  ],
});

import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      ".cloudflare-public/**",
      ".wrangler/**",
      "cloudflare/generated-*.mjs",
      "dist/**",
      "dist-cloudflare/**",
      "external-tools/**",
      "node_modules/**",
      "optimized-tiles/**",
      "outputs/**",
      "public/**",
      "tiles/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      sourceType: "module",
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      // These are existing baseline patterns. Keep the first CI rollout focused
      // on correctness errors such as undefined names and invalid control flow.
      "no-empty": "off",
      "no-unused-vars": "off",
      "no-useless-escape": "off",
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
    },
  },
];

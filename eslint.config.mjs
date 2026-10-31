import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vanilla app runtime (CommonJS/browser IIFEs) is verified by node --check
    // and the backend harnesses, not by the Next.js linter.
    "server.js",
    "js/**",
    "scripts/**",
    "tests/**",
    "muslim-commerce-attendance/**",
  ]),
]);

export default eslintConfig;

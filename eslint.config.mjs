import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

// `next lint` is deprecated in Next 15 and gone in Next 16, so linting runs
// through the ESLint CLI (`eslint .`) against this flat config instead.
//
// `eslint-config-next` still ships in the old `.eslintrc` "extends" format, so
// FlatCompat translates it to flat config. Same shape `create-next-app`
// generates for Next 15 + ESLint 9.
const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const eslintConfig = [
  {
    // Build output and third-party trees. `functions/dist` is the compiled
    // Azure Functions bundle (gitignored) — linting emitted JavaScript only
    // reports on tsc's output style, never on code anyone edits.
    ignores: [
      ".next/**",
      "out/**",
      "dist/**",
      "functions/dist/**",
      "coverage/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "supabase/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // A leading underscore is this repo's "deliberately unused" marker —
      // a parameter kept for signature shape, a destructured key skipped on
      // purpose. Without this the only way to silence it is deleting the name,
      // which loses the documentation.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
];

export default eslintConfig;

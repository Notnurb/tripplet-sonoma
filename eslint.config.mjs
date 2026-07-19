import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Standalone sub-projects and non-app code — not part of the Next.js build
      "vidapi/**",
      "services/**",
      "docs/**",
      "public/**",
      "scripts/**",
    ],
  },
  {
    rules: {
      // Pre-existing style debt — surfaced as warnings, not build-breakers.
      "react/no-unescaped-entities": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@next/next/no-html-link-for-pages": "warn",
    },
  },
];

export default eslintConfig;

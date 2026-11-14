import js from "@eslint/js";
import ts from "typescript-eslint";
import globals from "globals";
import hooks from "eslint-plugin-react-hooks";
export default ts.config(
  {
    ignores: [
      "dist/**",
      ".cache/**",
      "node_modules/**",
      "public/fonts/**",
      "coverage/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": hooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },

  ...["console", "workspace", "account"].map((area) => ({
    files: [`src/areas/${area}/**/*.{ts,tsx}`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["console", "workspace", "account"]
                .filter((other) => other !== area)
                .flatMap((other) => [
                  `@/areas/${other}/**`,
                  `**/areas/${other}/**`,
                  `**/../${other}/**`,
                ]),
              message:
                "UI areas must not import another area's implementation.",
            },
          ],
        },
      ],
    },
  })),
  {
    files: [
      "src/{features,components,hooks,api,domain,lib,types}/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/areas/**", "**/areas/**"],
              message: "Shared capabilities must not import UI areas.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/areas/**",
                "**/areas/**",
                "@/features/**",
                "**/features/**",
              ],
              message:
                "UI primitives must not import business capabilities or areas.",
            },
          ],
        },
      ],
    },
  },
);

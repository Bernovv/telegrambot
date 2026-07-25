import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      ".tools/**",
      "graphify-out/**"
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["apps/**/*.ts", "packages/**/*.ts", "scripts/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" }
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-require-imports": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "no-console": "error"
    }
  },
  {
    files: ["packages/contracts/**/*.ts", "packages/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{
            group: ["@ticket-platform/*"],
            message: "Contracts and domain code must not depend on another project package."
          }]
        }
      ]
    }
  },
  {
    files: ["packages/application/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{
            group: [
              "@ticket-platform/database",
              "@ticket-platform/messenger-*",
              "@ticket-platform/observability",
              "@nestjs/*",
              "fastify",
              "pg",
              "pg-boss"
            ],
            message: "Application code must depend on ports, not infrastructure adapters."
          }]
        }
      ]
    }
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ["**/*.test.ts"],
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/require-await": "off",
      "no-console": "off"
    }
  },
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "no-console": "off"
    }
  }
);

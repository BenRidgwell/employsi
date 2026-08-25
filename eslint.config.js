import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".output",
      ".vinxi",
      // Wrangler's build scratch. `wrangler dev` writes a bundled copy of the
      // Worker under <config dir>/.wrangler/tmp, so running it against
      // workers/jobs-cron/wrangler.jsonc drops a second one outside the root
      // .wrangler. Git ignores both; ESLint was still linting the bundles and
      // reporting a thousand prettier errors in generated output.
      "**/.wrangler/**",
      // Third-party bundles shipped verbatim with the waitlist design handoff
      // (React, lucide, topojson, the design-system bundle, world-atlas). They
      // are vendored artefacts, not source: nobody edits them here, Prettier
      // wants to reformat every minified line, and linting them took `npm run
      // lint` from seconds to minutes for eleven errors in react.js alone.
      "public/waitlist-preview/**",
      // Machine-generated data modules (each carries a "GENERATED — do not edit
      // by hand" header and is rewritten by a script in scripts/). Prettier would
      // reformat their compact one-line-per-record arrays into hundreds of
      // thousands of lines, and the very next generator run would undo it — so
      // the repo would oscillate between "lint passes" and "lint fails" with
      // every data refresh. Their shape is the generator's responsibility.
      "src/employsi/data/absOccupationSupply.ts",
      "src/employsi/data/auRealCoords.ts",
      "src/employsi/data/caVacancyDemand.ts",
      "src/employsi/data/companyHeadcount.ts",
      "src/employsi/data/euVacancyDemand.ts",
      "src/employsi/data/hkVacancyDemand.ts",
      "src/employsi/data/iviSkillDemand.ts",
      "src/employsi/data/nzVacancyDemand.ts",
      "src/employsi/data/phVacancyDemand.ts",
      "src/employsi/data/privateCompanyFacts.ts",
      "src/employsi/data/resolvedDomains.ts",
      "src/employsi/data/salaryBaseline.ts",
      "src/employsi/data/sharePrices.ts",
      "src/employsi/data/sgVacancyDemand.ts",
      "src/employsi/data/skillOntology.ts",
      "src/employsi/data/worldOutline.ts",
      "src/employsi/data/ukVacancyDemand.ts",
      "src/employsi/data/usVacancyDemand.ts",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  eslintPluginPrettier,
);

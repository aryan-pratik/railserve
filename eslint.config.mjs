import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Plan §2 / §13.2: MongoDB gives no row-level security, so a store manager
 * seeing another outlet's orders is purely a discipline problem in application
 * code. This rule is the enforcement half of that discipline — it fails the
 * build when the Order model is touched outside the scoped repository.
 *
 * The repository itself, the transition engine, and scripts are exempt.
 */
const DIRECT_MODEL_ACCESS =
  "MemberExpression[object.name='Order']" +
  "[property.name=/^(find|findOne|findById|findOneAndUpdate|findByIdAndUpdate|findOneAndDelete|aggregate|updateOne|updateMany|deleteOne|deleteMany|countDocuments|distinct|create|insertMany|bulkWrite|watch)$/]";

const ISOLATION_MESSAGE =
  "Direct Order model access leaks across outlets. Use lib/repo/orderRepo " +
  "(scoped reads) or lib/repo/transitionOrder (status writes) instead. " +
  "See plan §2 — this is the single biggest risk of the MongoDB stack choice.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    name: "railserve/store-isolation",
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/repo/**", "src/lib/models/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: DIRECT_MODEL_ACCESS, message: ISOLATION_MESSAGE },
      ],
      // The raw handle exists for ingestion and the transition engine. Naming
      // it in a page or route handler is almost always a mistake.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/models",
              importNames: ["Order"],
              message: ISOLATION_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;

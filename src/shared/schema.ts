/**
 * The OpenAPI document, derived from `OmpApi` at compile time.
 *
 * Run it to print the document: `bun run src/shared/schema.ts`. `bun run
 * gen:api` does exactly that and feeds the result to `wiz generate`.
 */
import { openapiSchema } from "wiz";

import type { Problem } from "./model.ts";
import type { OmpApi } from "./service.ts";

export const openapi = openapiSchema<[OmpApi, Problem]>({
  openapi: "3.1.0",
  info: {
    title: "omega",
    version: "1.0.0",
    description:
      "Web interface to a local omp coding agent. Every path and schema in " +
      "this document was derived from the TypeScript declarations in " +
      "src/shared by the wiz plugin.",
  },
  servers: [{ url: "/" }],
});

if (import.meta.main) {
  console.log(JSON.stringify(openapi, null, 2));
}

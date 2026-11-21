// Bundles the settlement API into self-contained ES-module functions for Vercel.
// Run after changing anything in server/ or shared/:   node scripts/bundle-api.mjs
import { createRequire } from "node:module";

// esbuild ships inside vite; resolve it through vite so this works under pnpm without extra deps.
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");

for (const name of ["config", "flip"]) {
  await build({
    entryPoints: [`server/entry-${name}.ts`],
    outfile: `api/${name}.js`,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm", // package.json has "type": "module", so .js files are ES modules
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    logLevel: "info",
  });
}

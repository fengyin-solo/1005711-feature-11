import { build } from 'esbuild'

await build({
  entryPoints: ['scripts/verify-relay.mts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'scripts/verify-bundle.mjs',
})

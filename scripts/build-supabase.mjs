import { build } from 'esbuild';
await build({entryPoints:['src/cwl/edge.js'],outfile:'supabase/functions/cwl/backend.js',bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['postgres'],minify:false});
console.log('Supabase persistence function built; ordinal fitting remains in the browser.');

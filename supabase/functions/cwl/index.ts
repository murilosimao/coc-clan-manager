// backend.js is generated from src/cwl by npm run build:supabase.
import { createEdgeHandler } from './backend.js';
const names=['DATABASE_URL','SUPABASE_URL','SUPABASE_ANON_KEY','CWL_EDITORS','CWL_BACKEND_KEY','CWL_APP_ORIGIN'];
Deno.serve(createEdgeHandler(()=>{
  const env=Object.fromEntries(names.map(name=>[name,Deno.env.get(name)]));
  env.SUPABASE_ANON_KEY = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default || env.SUPABASE_ANON_KEY;
  return env;
}));

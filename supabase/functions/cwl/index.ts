// backend.js is generated from src/cwl by npm run build:supabase.
import { createEdgeHandler } from './backend.js';
const names=['DATABASE_URL','SUPABASE_URL','SUPABASE_ANON_KEY','CWL_EDITORS','CWL_BACKEND_KEY','CWL_APP_ORIGIN','CWL_ACCESS_DB'];
Deno.serve(createEdgeHandler(()=>{
  const env=Object.fromEntries(names.map(name=>[name,Deno.env.get(name)]));
  env.SUPABASE_ANON_KEY = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default || env.SUPABASE_ANON_KEY;
  env.CWL_AUTH_ADMIN_KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  return env;
}));

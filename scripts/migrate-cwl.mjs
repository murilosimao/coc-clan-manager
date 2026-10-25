import fs from 'node:fs';
import { connectDatabase } from '../src/cwl/database.js';
export async function migrate(sql) {
  await sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(937125412)`;
    await tx.unsafe('CREATE SCHEMA IF NOT EXISTS cwl; CREATE TABLE IF NOT EXISTS cwl.migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());');
    for (const file of fs.readdirSync(new URL('../db/migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) {
      const [existing] = await tx`select version from cwl.migrations where version=${file}`;
      if (existing) continue;
      await tx.unsafe(fs.readFileSync(new URL('../db/migrations/' + file, import.meta.url), 'utf8'));
      await tx`insert into cwl.migrations(version) values(${file})`;
    }
  });
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const sql = connectDatabase(process.env);
  try { await migrate(sql); console.log('CWL migrations applied.'); }
  catch { console.error('CWL migration failed; check database availability and configuration.'); process.exitCode = 1; }
  finally { await sql.end(); }
}

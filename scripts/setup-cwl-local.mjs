import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
// Only creates ignored local secrets. Existing files and database credentials survive reruns.
if (!fs.existsSync('.env')) {
  const password = randomBytes(24).toString('hex');
  const key = randomBytes(32).toString('hex');
  fs.writeFileSync('.env', `CWL_POSTGRES_PASSWORD=${password}\nDATABASE_URL=postgres://coc_cwl:${password}@127.0.0.1:55432/coc_cwl\nLEADER_API_KEY=${key}\nLEADER_CLAN_TAG=2G8QCR92V\n`, { mode: 0o600 });
}
if (!fs.existsSync('.dev.vars')) {
  const values = Object.fromEntries(fs.readFileSync('.env', 'utf8').split('\n').filter(Boolean).map(l => l.split(/=(.*)/s).slice(0, 2)));
  fs.writeFileSync('.dev.vars', ['DATABASE_URL', 'LEADER_API_KEY', 'LEADER_CLAN_TAG'].filter(k => values[k]).map(k => `${k}=${values[k]}`).join('\n') + '\n', { mode: 0o600 });
}
console.log('Local secrets configured in ignored .env and .dev.vars. No credentials printed.');

import fs from 'node:fs';
import process from 'node:process';
import { decodeArchive } from '../src/cwl/archive.js';
import { validateBrowserPlan } from '../src/cwl/browser-plan.js';
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const file=arg('--snapshot','.wrangler/cwl-release-review/large-snapshot.gzip'),out=arg('--out','.wrangler/cwl-release-review/save-benchmark.json');
const bytes=fs.readFileSync(file),before=performance.now();
const payload=await decodeArchive(bytes),decoded=performance.now();
const result=validateBrowserPlan(payload,payload.raw.clan.tag.replace('#',''),payload.raw.startTime,Date.now());
const after=performance.now(),memory=globalThis.Deno?Deno.memoryUsage():process.memoryUsage();
const report={runtime:globalThis.Deno?'Deno '+Deno.version.deno:process.version,archiveBytes:bytes.length,
  decodeMs:decoded-before,validationMs:after-decoded,totalMs:after-before,heapUsedBytes:memory.heapUsed,rssBytes:memory.rss,
  events:payload.model.events.length,missions:result.assignments.length,serverFitExecuted:false,
  note:'Local validation benchmark; excludes DB and network time and does not prove hosted quotas.'};
fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify(report));

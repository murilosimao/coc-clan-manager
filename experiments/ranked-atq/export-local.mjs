// Loopback-only form for saving public DOM extracts from the browser tool.
import http from 'node:http';
import fs from 'node:fs';
const target=process.argv[2];
if(!target)throw new Error('output_path_required');
const form='<!doctype html><meta charset="utf-8"><title>Coleta local</title><h1>Salvar dados públicos da simulação</h1><form method="post" action="/save"><label>JSON extraído do ClashSpot<textarea name="data" style="display:block;width:90%;height:220px"></textarea></label><button>Salvar coleta local</button></form>';
http.createServer(async(req,res)=>{
  if(req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});const saved=fs.existsSync(target)?fs.readFileSync(target,'utf8'):'';res.end(form.replace('</textarea>',saved.replaceAll('&','&amp;').replaceAll('<','&lt;')+'</textarea>'));return;}
  if(req.method!=='POST'||req.url!=='/save'){res.writeHead(404);res.end();return;}
  if(req.headers.origin!=='http://127.0.0.1:'+String(process.argv[3]||8897)){res.writeHead(403);res.end();return;}
  let body='';for await(const part of req){body+=part;if(body.length>10_000_000){res.writeHead(413);res.end();return;}}
  try{const raw=new URLSearchParams(body).get('data');const data=JSON.parse(raw);fs.writeFileSync(target,JSON.stringify(data));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<p>Coleta salva localmente.</p><a href="/">Nova gravação</a>');}catch{res.writeHead(400);res.end('JSON inválido');}
}).listen(Number(process.argv[3]||8897),'127.0.0.1',()=>console.log('Local export form ready'));

import { requireCondition,CwlError } from './errors.js';
export async function readBytes(stream,limit){
  const reader=stream?.getReader();requireCondition(reader,400,'Corpo obrigatório.');
  const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>limit){await reader.cancel();throw new CwlError(413,'Requisição muito grande.');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
export async function decodeArchive(bytes){
  try{
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const decoded=await readBytes(stream,32*1024*1024);return JSON.parse(new TextDecoder().decode(decoded));
  }catch(error){if(error instanceof CwlError)throw error;throw new CwlError(422,'Snapshot de cálculo inválido.','invalid_archive');}
}
export async function readArchive(request){
  requireCondition(request.headers.get('Content-Type')?.split(';')[0]==='application/gzip',415,'Envie o snapshot comprimido.');
  const bytes=await readBytes(request.body,4*1024*1024);return {bytes,payload:await decodeArchive(bytes)};
}

// Purpose-separated authenticated encryption for cookies and private transport.
const encode=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decode=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
async function key(secret,purpose){
  if(typeof secret!=='string'||secret.length<32)throw new Error('Session encryption is not configured');
  const material=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(purpose+'\0'+secret));
  return crypto.subtle.importKey('raw',material,'AES-GCM',false,['encrypt','decrypt']);
}
export async function sealSession(value,secret,purpose){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(secret,purpose),new TextEncoder().encode(value));
  return 'v1.'+encode(iv)+'.'+encode(new Uint8Array(encrypted));
}
export async function openSession(value,secret,purpose){
  if(typeof value!=='string'||value.length>32768||!/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/.test(value))throw new Error('Invalid encrypted session');
  const [,nonce,data]=value.split('.');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(nonce)},await key(secret,purpose),decode(data));
  return new TextDecoder().decode(plain);
}

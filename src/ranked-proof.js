// Public facts are signed separately from sessions; the signing key never leaves the servers.
const encoder = new TextEncoder();
const body = packet => JSON.stringify({ version: packet.version, kind: packet.kind, fetchedAt: packet.fetchedAt, items: packet.items });
async function key(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('ranked_signing_unavailable');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
const message = packet => encoder.encode('ranked-source-v1\n' + body(packet));
export async function signRanked(packet, secret) {
  const signature = await crypto.subtle.sign('HMAC', await key(secret), message(packet));
  return { ...packet, signature: Array.from(new Uint8Array(signature), n => n.toString(16).padStart(2, '0')).join('') };
}
export async function verifyRanked(snapshot, secret, now = Date.now()) {
  if (!snapshot) return true;
  if (!Array.isArray(snapshot.packets) || snapshot.packets.length < 1 || snapshot.packets.length > 250) return false;
  const signingKey = await key(secret);
  for (const packet of snapshot.packets) {
    if (packet?.version !== 1 || !['family', 'players', 'levels'].includes(packet.kind) || !Array.isArray(packet.items)
      || packet.items.length > 100 || !Number.isFinite(packet.fetchedAt) || packet.fetchedAt > now + 30000
      || now - packet.fetchedAt > 6 * 3600000 || !/^[a-f0-9]{64}$/.test(packet.signature || '')) return false;
    const bytes = new Uint8Array(packet.signature.match(/../g).map(s => parseInt(s, 16)));
    if (!await crypto.subtle.verify('HMAC', signingKey, bytes, message(packet))) return false;
  }
  // Duplicate identities permit selective reference replacement and are rejected.
  for (const kind of ['family', 'players', 'levels']) {
    const rows = snapshot.packets.filter(p => p.kind === kind).flatMap(p => p.items);
    if (new Set(rows.map(p => p.tag)).size !== rows.length) return false;
  }
  return snapshot.packets.filter(p => p.kind === 'family').length === 1;
}

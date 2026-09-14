// Find Taproom servers on this LAN — the same handshake the Fire TV app uses.
//   node scripts/find-server.mjs
import { probe } from '../src/discovery.js';

const found = await probe({ timeoutMs: 2000 });
if (!found.length) {
  console.log('No servers answered. Is one running, and is UDP broadcast allowed on this network?');
  process.exit(1);
}
for (const s of found) console.log(`${s.name}  ->  ${s.url}`);

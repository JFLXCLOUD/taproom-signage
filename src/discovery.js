import dgram from 'node:dgram';

// LAN discovery for the Fire TV app, so a screen never needs an IP typed into it.
//
// Deliberately a UDP broadcast handshake rather than mDNS: it is a dozen lines
// with no dependency, and it works on the networks where mDNS tends not to.
//
//   client -> 255.255.255.255:41234   "TAPROOM-DISCOVER/1"
//   server -> (unicast back)          {"proto":"taproom/1","name":"RCYC","port":8080}
//
// The reply carries no address. The client takes the host from the *source IP*
// of the reply packet, which sidesteps the whole problem of a multi-homed box
// guessing which of its own addresses the client can actually reach — on the Pi
// build it has at least three (ethernet, its own access point, and Tailscale).

export const DISCOVERY_PORT = Number(process.env.DISCOVERY_PORT || 41234);
const PROBE = 'TAPROOM-DISCOVER/1';
const PROTO = 'taproom/1';

export function startDiscovery({ httpPort, venueName }) {
  if (process.env.DISCOVERY === '0') {
    console.log('  Discovery   disabled (DISCOVERY=0)');
    return null;
  }

  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('message', (msg, rinfo) => {
    if (msg.toString('utf8').trim() !== PROBE) return;

    const reply = Buffer.from(JSON.stringify({
      proto: PROTO,
      name: typeof venueName === 'function' ? venueName() : venueName,
      port: httpPort
    }));

    socket.send(reply, rinfo.port, rinfo.address, (err) => {
      if (err) console.warn('[discovery] reply failed', err.message);
    });
  });

  socket.on('error', (err) => {
    // Never take the signage down because discovery could not bind.
    console.warn(`[discovery] disabled: ${err.message}`);
    try { socket.close(); } catch { /* already closed */ }
  });

  socket.on('listening', () => {
    try { socket.setBroadcast(true); } catch { /* not required to reply */ }
    console.log(`  Discovery   udp/${DISCOVERY_PORT} (Fire TV app finds this box by itself)`);
  });

  socket.bind(DISCOVERY_PORT);
  socket.unref();
  return socket;
}

/** Client side of the handshake — used by scripts/find-server.mjs and tests. */
export function probe({ timeoutMs = 1500, port = DISCOVERY_PORT } = {}) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const found = [];

    const done = () => {
      try { socket.close(); } catch { /* already closed */ }
      resolve(found);
    };

    socket.on('message', (msg, rinfo) => {
      try {
        const body = JSON.parse(msg.toString('utf8'));
        if (body.proto !== PROTO) return;
        found.push({
          name: body.name,
          host: rinfo.address,
          port: body.port,
          url: `http://${rinfo.address}:${body.port}`
        });
      } catch { /* not one of ours */ }
    });

    socket.on('error', done);
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(PROBE, port, '255.255.255.255');
    });

    setTimeout(done, timeoutMs);
  });
}

// Static checks for the Fire TV app source.
//
// There is no Android SDK in this toolchain, so this cannot compile the APK. It
// catches the mistakes that would otherwise only surface on a real stick:
// malformed resource XML, a string reference with no string behind it, and —
// most importantly — the discovery constants drifting apart from the server's.
//
//   node scripts/check-firetv.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'firetv');

let failures = 0;
const fail = (msg) => { failures++; console.log('FAIL  ' + msg); };
const ok = (msg) => console.log('  ok  ' + msg);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full.replace(/\\/g, '/'));
  }
  return out;
}

const files = walk(APP);
const read = (p) => readFileSync(p, 'utf8');
const rel = (p) => path.relative(APP, p).replace(/\\/g, '/');

// ------------------------------------------------------------------ 1. XML

const xmlFiles = files.filter((f) => f.endsWith('.xml'));
const py = `
import sys, json, xml.etree.ElementTree as ET
out = {}
for f in json.loads(sys.stdin.read()):
    try:
        ET.parse(f)
        out[f] = None
    except Exception as e:
        out[f] = str(e)
print(json.dumps(out))
`;
const parsed = JSON.parse(
  execFileSync('python', ['-c', py], { input: JSON.stringify(xmlFiles), encoding: 'utf8' })
);
for (const [file, err] of Object.entries(parsed)) {
  if (err) fail(`xml ${rel(file)}: ${err}`);
  else ok(`xml ${rel(file)}`);
}

// --------------------------------------------------- 2. string resources

const stringsXml = read(path.join(APP, 'app/src/main/res/values/strings.xml'));
const defined = new Set([...stringsXml.matchAll(/<string\s+name="([^"]+)"/g)].map((m) => m[1]));

const referenced = new Set();
for (const file of files.filter((f) => f.endsWith('.kt'))) {
  for (const m of read(file).matchAll(/R\.string\.([A-Za-z0-9_]+)/g)) referenced.add(m[1]);
}
for (const file of xmlFiles) {
  for (const m of read(file).matchAll(/@string\/([A-Za-z0-9_]+)/g)) referenced.add(m[1]);
}

for (const name of [...referenced].sort()) {
  if (defined.has(name)) ok(`@string/${name}`);
  else fail(`@string/${name} is referenced but not defined`);
}
for (const name of [...defined].sort()) {
  if (!referenced.has(name)) console.log(`  --  @string/${name} defined but unused`);
}

// ------------------------------------------------------- 3. other resources

const manifest = read(path.join(APP, 'app/src/main/AndroidManifest.xml'));
for (const m of manifest.matchAll(/@drawable\/([A-Za-z0-9_]+)/g)) {
  const target = path.join(APP, `app/src/main/res/drawable/${m[1]}.xml`).replace(/\\/g, '/');
  if (files.includes(target)) ok(`@drawable/${m[1]}`);
  else fail(`@drawable/${m[1]} is referenced but missing`);
}
for (const m of manifest.matchAll(/@style\/([A-Za-z0-9_]+)/g)) {
  const styles = read(path.join(APP, 'app/src/main/res/values/styles.xml'));
  if (new RegExp(`name="${m[1]}"`).test(styles)) ok(`@style/${m[1]}`);
  else fail(`@style/${m[1]} is referenced but missing`);
}

// Every Kotlin class named in the manifest must exist.
const pkgDir = path.join(APP, 'app/src/main/java/com/taproom/signage');
for (const m of manifest.matchAll(/android:name="\.([A-Za-z0-9_]+)"/g)) {
  const target = path.join(pkgDir, `${m[1]}.kt`).replace(/\\/g, '/');
  if (files.includes(target)) ok(`class .${m[1]}`);
  else fail(`manifest names .${m[1]} but ${m[1]}.kt is missing`);
}

// ------------------------------------------- 4. protocol matches the server

const serverSrc = read(path.join(ROOT, 'src/discovery.js'));
const appSrc = read(path.join(pkgDir, 'Discovery.kt'));

const pairs = [
  ['probe string', /const PROBE = '([^']+)'/, /PROBE = "([^"]+)"/],
  ['proto tag', /const PROTO = '([^']+)'/, /PROTO = "([^"]+)"/],
  ['discovery port', /DISCOVERY_PORT \|\| (\d+)\)/, /DISCOVERY_PORT = (\d+)/]
];

for (const [label, serverRe, appRe] of pairs) {
  const a = serverSrc.match(serverRe)?.[1];
  const b = appSrc.match(appRe)?.[1];
  if (a === undefined || b === undefined) {
    fail(`${label}: could not read it from ${a === undefined ? 'the server' : 'the app'}`);
  } else if (a !== b) {
    fail(`${label} mismatch — server ${JSON.stringify(a)}, app ${JSON.stringify(b)}`);
  } else {
    ok(`${label} matches server (${a})`);
  }
}

// The sweep fallback identifies our server by this field in /api/health.
if (/optString\("app"\) == "taproom-signage"/.test(appSrc)) {
  if (/app: 'taproom-signage'/.test(read(path.join(ROOT, 'src/server.js')))) {
    ok("health identity matches server (app: 'taproom-signage')");
  } else {
    fail("app expects health app='taproom-signage' but the server does not send it");
  }
}

// Cleartext HTTP is mandatory: the server is plain HTTP on the LAN.
if (/android:usesCleartextTraffic="true"/.test(manifest)) ok('cleartext HTTP allowed');
else fail('usesCleartextTraffic is not set — every request would be blocked');

// Auto-start needs both the permission and a BOOT_COMPLETED filter.
if (/RECEIVE_BOOT_COMPLETED/.test(manifest) && /BOOT_COMPLETED"\/>/.test(manifest)) {
  ok('boot receiver wired');
} else {
  fail('boot auto-start is not wired up');
}

console.log(failures ? `\n${failures} problem(s)` : '\nAll static checks passed');
process.exit(failures ? 1 : 0);

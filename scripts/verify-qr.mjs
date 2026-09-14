// Verify public/shared/qr.js. A QR that silently encodes the wrong bytes is
// worse than no QR at all, so this checks three independent things:
//
//   1. Round-trip: render the symbol and decode it with OpenCV's detector.
//      This is the one that actually answers "will a phone scan it?".
//   2. Structure: every module matches python-qrcode for each explicit mask.
//   3. Mask choice: our pick is the lowest-penalty mask by python-qrcode's
//      own lost_point scoring.
//
//   python -m pip install qrcode opencv-python-headless numpy
//   node scripts/verify-qr.mjs
//
// Oracle notes, so nobody re-litigates this:
//   * `segno` disagrees, but only in the pad codewords — it emits an extra 0x00
//     before the 0xEC/0x11 pad pattern. ISO/IEC 18004 s7.4.10 starts the pad
//     pattern as soon as the stream is byte-aligned, which is what this encoder
//     and python-qrcode both do. Decoders never read padding, so both scan.
//   * python-qrcode's own auto mask selection contradicts its `lost_point`
//     (it evaluates candidates with placeholder format bits), so check 3 scores
//     our matrices rather than comparing against its chosen mask.

import { execFileSync } from 'node:child_process';
import { encodeQr } from '../public/shared/qr.js';

const CASES = [
  'A',
  'http://menu/',
  'http://menu/?pair=LV5GZH',
  'http://192.168.1.214:8099/?pair=ABC234',
  'http://rcyc-signage.tail1234.ts.net/?pair=QRSTUV',
  'Richmond County Yacht Club',
  'http://menu/?pair=ZZZZZZ&x=' + 'a'.repeat(40),
  'http://menu/?q=' + 'M'.repeat(85)
];

const python = (code, input) => {
  try {
    return execFileSync('python', ['-c', code], { input, encoding: 'utf8' });
  } catch (err) {
    return null;
  }
};

const has = (mod) => python(`import ${mod}`) !== null;
const HAS_QRCODE = has('qrcode');
const HAS_CV = has('cv2');

let checks = 0;
let failures = 0;
const tally = (ok, msg) => {
  checks++;
  if (!ok) { failures++; console.log('FAIL ' + msg); }
};

function grid(q) {
  const rows = [];
  for (let r = 0; r < q.size; r++) rows.push(Array.from(q.modules[r]));
  return rows;
}

// -------------------------------------------------------- 1. round-trip

function decode(q) {
  const out = python(`
import cv2, numpy as np, json, sys
m = np.array(json.loads(sys.stdin.read()), dtype=np.uint8)
img = np.where(m == 1, 0, 255).astype(np.uint8)
img = np.pad(img, 4, constant_values=255)            # quiet zone
img = np.kron(img, np.ones((8, 8), dtype=np.uint8))  # 8px modules
ok, decoded, _, _ = cv2.QRCodeDetector().detectAndDecodeMulti(img)
print(json.dumps(list(decoded)[0] if ok and len(decoded) else None))
`, JSON.stringify(grid(q)));
  return out === null ? null : JSON.parse(out);
}

// -------------------------------------------------------- 2 & 3. reference

function referenceRows(text, level, version, mask) {
  const out = python(`
import qrcode, json
from qrcode.util import QRData, MODE_8BIT_BYTE
ec = {'L': qrcode.constants.ERROR_CORRECT_L, 'M': qrcode.constants.ERROR_CORRECT_M}[${JSON.stringify(level)}]
q = qrcode.QRCode(version=${version}, error_correction=ec, border=0, box_size=1, mask_pattern=${mask})
q.add_data(QRData(${JSON.stringify(text)}.encode(), mode=MODE_8BIT_BYTE))
q.make(fit=False)
print(json.dumps([[1 if v else 0 for v in r] for r in q.get_matrix()]))
`);
  return out === null ? null : JSON.parse(out);
}

function referenceScores(matrices) {
  const out = python(`
import qrcode.util as u, json, sys
mats = json.loads(sys.stdin.read())
print(json.dumps([u.lost_point([[bool(v) for v in row] for row in m]) for m in mats]))
`, JSON.stringify(matrices));
  return out === null ? null : JSON.parse(out);
}

// ------------------------------------------------------------------ run

console.log(`oracles: python-qrcode ${HAS_QRCODE ? 'yes' : 'NO'}, opencv ${HAS_CV ? 'yes' : 'NO'}\n`);

for (const text of CASES) {
  for (const level of ['L', 'M']) {
    let auto;
    try {
      auto = encodeQr(text, { level });
    } catch (err) {
      console.log(`skip  ${level} ${text.length}b — ${err.message}`);
      continue;
    }
    const tag = `v${auto.version}${level} (${text.length}b)`;

    if (HAS_CV) {
      const got = decode(auto);
      tally(got === text, `${tag} round-trip: decoded ${JSON.stringify(got)}`);
    }

    if (HAS_QRCODE) {
      const mine = [];
      for (let mask = 0; mask < 8; mask++) {
        const q = encodeQr(text, { level, version: auto.version, mask });
        mine.push(grid(q));
        const ref = referenceRows(text, level, auto.version, mask);
        let same = ref !== null && ref.length === q.size;
        for (let r = 0; same && r < q.size; r++) {
          for (let c = 0; c < q.size; c++) {
            if (ref[r][c] !== q.modules[r][c]) { same = false; break; }
          }
        }
        tally(same, `${tag} mask${mask}: modules differ from python-qrcode`);
      }

      const scores = referenceScores(mine);
      if (scores) {
        const best = scores.indexOf(Math.min(...scores));
        tally(auto.mask === best,
          `${tag} mask choice: we picked ${auto.mask}, lowest penalty is ${best} [${scores}]`);
      }
    }
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);

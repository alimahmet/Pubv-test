// PBUV phone test: runs the Crescent wasm in a worker so the page stays responsive.
// Timings are measured here, around the wasm calls only.
import init, { pbuv_show_wasm, pbuv_verify_wasm } from './pkg/crescent.js';

// utils::utc_now_seconds calls this in wasm builds; it returns u64, so it must be a BigInt
globalThis.js_now_seconds = () => BigInt(Math.floor(Date.now() / 1000));

let data = null;

function proveVerify(a, p) {
  const t0 = performance.now();
  const proof = pbuv_show_wasm(data.client_state, data.range_pk, data.io_locations, data.proof_spec, a);
  const t1 = performance.now();
  let ok = false, result;
  try {
    result = pbuv_verify_wasm(proof, data.groth16_vk, data.groth16_pvk, data.range_vk, data.io_locations,
      data.issuer_pem, data.config, data.proof_spec, a, p.nonce, p.verifier, p.request, p.rpId, p.origin);
    ok = true;
  } catch (e) { result = String(e); }
  const t2 = performance.now();
  return { proof, proveMs: t1 - t0, verifyMs: t2 - t1, ok, result };
}

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.cmd === 'load') {
      const [wasm, d] = await Promise.all([
        fetch('./pkg/crescent_bg.wasm').then(r => { if (!r.ok) throw new Error('pkg/crescent_bg.wasm: HTTP ' + r.status); return r.arrayBuffer(); }),
        fetch('./' + m.file).then(r => { if (!r.ok) throw new Error(m.file + ': HTTP ' + r.status); return r.json(); }),
      ]);
      await init({ module_or_path: wasm });
      data = d;
      postMessage({ type: 'loaded', name: d.name, file: m.file, wasmBytes: wasm.byteLength });
    } else if (m.cmd === 'once') {
      postMessage({ type: 'progress', text: 'Proving...' });
      postMessage({ type: 'once', ...proveVerify(m.assertion, m.params) });
    } else if (m.cmd === 'repeat') {
      const runs = [];
      for (let i = 0; i < m.n; i++) {
        const r = proveVerify(m.assertion, m.params);
        runs.push({ proveMs: r.proveMs, verifyMs: r.verifyMs, ok: r.ok, bytes: Math.floor(r.proof.length * 3 / 4) });
        postMessage({ type: 'progress', text: `Run ${i + 1} of ${m.n}: prove ${r.proveMs.toFixed(1)} ms, verify ${r.verifyMs.toFixed(1)} ms, ${r.ok ? 'verified' : 'NOT verified: ' + r.result}` });
      }
      postMessage({ type: 'repeat', runs });
    }
  } catch (e) {
    postMessage({ type: 'error', text: String(e && e.stack ? e.message + '\n' + e.stack : e) });
  }
};

// アンビエントBGMを合成して public/bgm/ambient.wav を生成する。
// 方針: 落ち着いた・激しくない・少し不思議な浮遊空間。
// 純サイン波の加算合成のみ。各成分の周波数を「ループ長の整数倍サイクル」に丸めるため、
// バッファ末尾と先頭が連続し、継ぎ目のない無限ループになる（ノイズ/打撃音は使わない）。
//
// 実行: node scripts/gen-bgm.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 22050;          // サンプルレート（パッド主体なので十分）
const LOOP = 30;           // ループ長(秒)。長めにして反復感を薄める
const N = SR * LOOP;       // 1chのサンプル数
const TAU = Math.PI * 2;

// 周波数をループ長の整数サイクルに丸める（=完全シームレス化）。
const seam = (f) => Math.round(f * LOOP) / LOOP;

// Am(add9): 根音A + 5度 + 短3度(哀愁) + 9度(浮遊感) で「少し不思議」な静謐パッド。
// a=音量, harm=倍音の相対音量, lfoT=音量うねりの周期(秒), pan=-1..1
const VOICES = [
  { f: 110.0,  a: 0.24, harm: [1, 0.38, 0.12], lfoT: 23, pan: -0.15 }, // A2 ドローン
  { f: 164.81, a: 0.12, harm: [1, 0.30],        lfoT: 19, pan:  0.25 }, // E3 5度
  { f: 220.0,  a: 0.14, harm: [1, 0.28],        lfoT: 17, pan: -0.30 }, // A3
  { f: 261.63, a: 0.085,harm: [1, 0.22],        lfoT: 13, pan:  0.35 }, // C4 短3度
  { f: 246.94, a: 0.07, harm: [1, 0.18],        lfoT: 29, pan: -0.40 }, // B3 9度
  { f: 329.63, a: 0.05, harm: [1],              lfoT: 11, pan:  0.40 }, // E4 うっすら
];

// 高域の微かな空気感（ゆっくり明滅）。
const AIR = { f: 1318.51, a: 0.022, lfoT: 14.5 }; // E6

// 遠くで鳴る微かなベル（ガウス包絡で境界から離して配置 → ループを壊さない）。
const BELLS = [
  { t: 6.0,  f: 659.25, a: 0.050, sig: 0.95, pan: -0.45 }, // E5
  { t: 13.0, f: 987.77, a: 0.040, sig: 0.85, pan:  0.50 }, // B5
  { t: 19.5, f: 880.0,  a: 0.046, sig: 0.95, pan:  0.10 }, // A5
  { t: 25.0, f: 783.99, a: 0.040, sig: 1.05, pan: -0.30 }, // G5
];

const L = new Float64Array(N);
const R = new Float64Array(N);

const panGain = (pan) => {
  // 等パワーパン。
  const x = (pan + 1) / 2;
  return [Math.cos(x * (Math.PI / 2)), Math.sin(x * (Math.PI / 2))];
};

for (const v of VOICES) {
  const lfoF = seam(1 / v.lfoT);
  const [gl, gr] = panGain(v.pan);
  // L/R をわずかにデチューン＆位相差して横方向の広がり（不思議な空間）を作る。
  const fR = (h) => seam(v.f * h * 1.0008);
  const fL = (h) => seam(v.f * h);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    // 音量のゆっくりした明滅（0.55〜1.0）。
    const env = 0.55 + 0.45 * Math.sin(TAU * lfoF * t);
    let sl = 0;
    let sr = 0;
    for (let h = 0; h < v.harm.length; h++) {
      const ha = v.harm[h];
      sl += ha * Math.sin(TAU * fL(h + 1) * t);
      sr += ha * Math.sin(TAU * fR(h + 1) * t + Math.PI / 3);
    }
    const amp = v.a * env;
    L[i] += amp * gl * sl;
    R[i] += amp * gr * sr;
  }
}

// 高域エア。
{
  const lfoF = seam(1 / AIR.lfoT);
  const fL = seam(AIR.f);
  const fR = seam(AIR.f * 1.0011);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const env = 0.4 + 0.6 * Math.max(0, Math.sin(TAU * lfoF * t));
    L[i] += AIR.a * env * Math.sin(TAU * fL * t);
    R[i] += AIR.a * env * Math.sin(TAU * fR * t + Math.PI / 2);
  }
}

// ベル（境界付近では包絡がほぼ0なのでループは保たれる）。
for (const b of BELLS) {
  const [gl, gr] = panGain(b.pan);
  const fq = seam(b.f);
  const fq2 = seam(b.f * 2.01); // 倍音で金属的な響き
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const d = t - b.t;
    const env = Math.exp(-(d * d) / (2 * b.sig * b.sig));
    if (env < 1e-4) continue;
    const s = b.a * env * (Math.sin(TAU * fq * t) + 0.3 * Math.sin(TAU * fq2 * t));
    L[i] += gl * s;
    R[i] += gr * s;
  }
}

// ピーク正規化（ヘッドルームを残す）。
let peak = 0;
for (let i = 0; i < N; i++) {
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = peak > 0 ? 0.82 / peak : 1;

// 16bit PCM ステレオ WAV を書き出す。
const bytesPerSample = 2;
const dataSize = N * 2 * bytesPerSample;
const buf = Buffer.alloc(44 + dataSize);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + dataSize, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);          // fmt chunk size
buf.writeUInt16LE(1, 20);           // PCM
buf.writeUInt16LE(2, 22);           // channels
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 2 * bytesPerSample, 28); // byte rate
buf.writeUInt16LE(2 * bytesPerSample, 32);      // block align
buf.writeUInt16LE(16, 34);          // bits per sample
buf.write('data', 36);
buf.writeUInt32LE(dataSize, 40);

let off = 44;
for (let i = 0; i < N; i++) {
  const l = Math.max(-1, Math.min(1, L[i] * norm));
  const r = Math.max(-1, Math.min(1, R[i] * norm));
  buf.writeInt16LE((l * 32767) | 0, off);
  buf.writeInt16LE((r * 32767) | 0, off + 2);
  off += 4;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = resolve(__dirname, '../public/bgm/ambient.wav');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buf);
console.log(`wrote ${out} (${(buf.length / 1024 / 1024).toFixed(2)} MB, ${LOOP}s loop, ${SR}Hz stereo, peak ${peak.toFixed(3)})`);

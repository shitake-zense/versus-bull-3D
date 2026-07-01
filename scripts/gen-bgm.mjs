// ゲームBGMを合成して public/bgm/ambient.wav を生成する。
// 方針: 重低音・ローテンポの鼓動リズム・少し不思議(ミステリアス)な浮遊空間。
//
// 構成は2層:
//  1) 持続パッド層（純サイン加算, seam() で「ループ長の整数サイクル」に丸めて完全シームレス）。
//     短調の固定パッドに対しベース根音がゆっくり動く(Am→F→G→E)ので、
//     和声が F△7 / G6/9 / E… と移ろい「不思議」な色になる。
//  2) 鼓動リズム層（イベント方式）。各イベントは開始で振幅0(サイン位相0)・末尾で減衰0に
//     なるので不連続が出ず、ループ境界付近(先頭/末尾)には配置しないためループを壊さない。
//
// 実行: node scripts/gen-bgm.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 22050;          // サンプルレート
const LOOP = 32;           // ループ長(秒)。16小節×2s or 8小節×4s のグリッドに合う長さ
const N = SR * LOOP;       // 1chのサンプル数
const TAU = Math.PI * 2;

// 周波数をループ長の整数サイクルに丸める（=持続音を完全シームレス化）。
const seam = (f) => Math.round(f * LOOP) / LOOP;

const L = new Float64Array(N);
const R = new Float64Array(N);

// 等パワーパン。
const panGain = (pan) => {
  const x = (pan + 1) / 2;
  return [Math.cos(x * (Math.PI / 2)), Math.sin(x * (Math.PI / 2))];
};

// ============================================================
// 1) 持続パッド層
// ============================================================

// Am(add9) 系の静謐パッド + 重低音ドローン。
// a=音量, harm=倍音の相対音量, lfoT=音量うねりの周期(秒), pan=-1..1
const VOICES = [
  { f: 55.0,   a: 0.34, harm: [1, 0.22],        lfoT: 27, pan:  0.00 }, // A1 重低音ドローン
  { f: 110.0,  a: 0.20, harm: [1, 0.34, 0.10],  lfoT: 23, pan: -0.15 }, // A2
  { f: 164.81, a: 0.11, harm: [1, 0.28],        lfoT: 19, pan:  0.25 }, // E3 5度
  { f: 220.0,  a: 0.12, harm: [1, 0.26],        lfoT: 17, pan: -0.30 }, // A3
  { f: 261.63, a: 0.075,harm: [1, 0.20],        lfoT: 13, pan:  0.35 }, // C4 短3度
  { f: 246.94, a: 0.06, harm: [1, 0.16],        lfoT: 29, pan: -0.40 }, // B3 9度(浮遊感)
  { f: 329.63, a: 0.045,harm: [1],              lfoT: 11, pan:  0.40 }, // E4 うっすら
];

for (const v of VOICES) {
  const lfoF = seam(1 / v.lfoT);
  const [gl, gr] = panGain(v.pan);
  // L/R をわずかにデチューン＆位相差して横方向の広がり（不思議な空間）を作る。
  const fR = (h) => seam(v.f * h * 1.0008);
  const fL = (h) => seam(v.f * h);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
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

// 高域の微かな空気感（ゆっくり明滅）。
{
  const AIR = { f: 1318.51, a: 0.020, lfoT: 14.5 }; // E6
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

// 遠くで鳴る微かなベル（ガウス包絡で境界から離して配置 → ループを壊さない）。
{
  const BELLS = [
    { t: 6.0,  f: 659.25, a: 0.045, sig: 0.95, pan: -0.45 }, // E5
    { t: 14.0, f: 987.77, a: 0.036, sig: 0.85, pan:  0.50 }, // B5
    { t: 21.0, f: 880.0,  a: 0.042, sig: 0.95, pan:  0.10 }, // A5
    { t: 27.0, f: 783.99, a: 0.036, sig: 1.05, pan: -0.30 }, // G5
  ];
  for (const b of BELLS) {
    const [gl, gr] = panGain(b.pan);
    const fq = seam(b.f);
    const fq2 = seam(b.f * 2.01);
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
}

// ============================================================
// 2) 鼓動リズム層（イベント方式）
// ============================================================
// イベントを [t0, t0+dur] の窓に加算する汎用関数。
// sampleFn(d) は d=経過秒 を受け mono 値を返す。窓の外(0..LOOP)や
// ループ境界に食い込むものは呼び出し側で除外する。
function addEvent(t0, dur, pan, sampleFn) {
  const [gl, gr] = panGain(pan);
  const i0 = Math.max(0, Math.floor(t0 * SR));
  const i1 = Math.min(N, Math.ceil((t0 + dur) * SR));
  for (let i = i0; i < i1; i++) {
    const d = i / SR - t0;
    if (d < 0) continue;
    const s = sampleFn(d);
    L[i] += gl * s;
    R[i] += gr * s;
  }
}

// 重低音キック: サイン位相0開始→急速減衰。ピッチが 100Hz→42Hz へ落ちる「ドゥン」。
function kick(amp) {
  return (d) => {
    // 位相 = 2π∫freq, freq = 42 + 60*exp(-24d)（積分して滑らかなピッチ降下）
    const phase = TAU * (42 * d + (60 / 24) * (1 - Math.exp(-24 * d)));
    const body = Math.exp(-d * 6.5) * Math.sin(phase);
    // 拍を締める微かなアタック（すぐ消える, 中央）。
    const click = Math.exp(-d * 90) * Math.sin(TAU * 900 * d) * 0.12;
    return amp * (body + click);
  };
}

// ベース音（プラック): 柔らかいアタック+減衰。倍音少しでウォーム&ミステリアス。
function bass(freq, amp, detune = 0) {
  const f = freq * (1 + detune);
  return (d) => {
    const env = (1 - Math.exp(-d / 0.015)) * Math.exp(-d / 0.55);
    const s = Math.sin(TAU * f * d) + 0.28 * Math.sin(TAU * 2 * f * d) + 0.1 * Math.sin(TAU * 3 * f * d);
    return amp * env * s;
  };
}

// ゴースト（裏拍の弱い低音パルス, 5度上）: 揺らぎ・不思議さを足す。
function ghost(freq, amp) {
  return (d) => {
    const env = Math.exp(-d * 9);
    return amp * env * Math.sin(TAU * freq * d);
  };
}

// --- グルーヴ生成 ---
// 8小節(各4s, 60BPM=4拍/小節)。キックは半拍(0拍/2拍)でローテンポの鼓動。
// ベース根音: Am→Am→F→G→Am→Am→F→E（固定パッドに対して和声が移ろう）。
const BAR = 4;                       // 小節長(秒)
const BARS = LOOP / BAR;             // 8
const ROOTS = [55.0, 55.0, 43.65, 49.0, 55.0, 55.0, 43.65, 41.2]; // A1 A1 F1 G1 A1 A1 F1 E1

for (let b = 0; b < BARS; b++) {
  const barT = b * BAR;
  const root = ROOTS[b];
  // 境界を汚さないため、最初と最後の小節では端に寄るイベントを控える。
  const isFirst = b === 0;
  const isLast = b === BARS - 1;

  // キック: 0拍・2拍（重低音の鼓動）。1小節目の頭は境界近くなので少し後ろへずらす。
  if (!isFirst) addEvent(barT + 0.0, 1.0, 0.0, kick(0.55));
  addEvent(barT + 2.0, 1.0, 0.0, kick(0.5));

  // ベース: 0拍・2拍（キックと同期, 左右わずかに広げる）。
  if (!isFirst) {
    addEvent(barT + 0.0, 1.5, -0.12, bass(root, 0.30));
    addEvent(barT + 0.0, 1.5, 0.12, bass(root, 0.30, 0.001));
  }
  addEvent(barT + 2.0, 1.5, -0.12, bass(root, 0.28));
  addEvent(barT + 2.0, 1.5, 0.12, bass(root, 0.28, 0.001));

  // ゴースト裏拍: 1.5拍・3.5拍に5度上の弱パルス（不思議な揺らぎ）。末尾小節の3.5は省く。
  addEvent(barT + 1.5, 0.5, 0.3, ghost(root * 1.5, 0.10));
  if (!isLast) addEvent(barT + 3.5, 0.5, -0.3, ghost(root * 2.0, 0.075));
}

// ============================================================
// ピーク正規化（ヘッドルームを残す）。
// ============================================================
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

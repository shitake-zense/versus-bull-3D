// OrbitControls + ビュープリセット(1/2/3)切り替え。
// 切り替え時は 600ms かけてカメラ位置とターゲットを lerp する。
// followEnabled=true で、直前着手のマスが見やすい角度へ自動追従する。

import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { cellToXZ } from './Board3D';
import { layerY } from './Piece3D';

export type CameraView = 1 | 2 | 3;

// 各プリセットのカメラ位置（ターゲットは常に原点）
const PRESETS: Record<CameraView, Vector3> = {
  1: new Vector3(0, 9.5, 0.001), // トップビュー
  2: new Vector3(0, 5.4, 7.4), // デフォルト（仰角約35°）
  3: new Vector3(8.2, 2.2, 0.5), // ドラマチック（水平寄り）
};

const ANIM_MS = 600;
// 追従カメラの軌道半径・高さ（プリセット2と同等の仰角）。
const FOLLOW_R = 7.4;
const FOLLOW_H = 5.4;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** カメラをターゲット中心の円柱座標（水平半径 r・方位角 theta・高さ h）に分解する。 */
function orbitOf(pos: Vector3, target: Vector3): { r: number; theta: number; h: number } {
  const ox = pos.x - target.x;
  const oz = pos.z - target.z;
  return { r: Math.hypot(ox, oz), theta: Math.atan2(ox, oz), h: pos.y - target.y };
}

/** 角度差を (-π, π] に正規化（回り込みは常に短い方の弧＝盤中心を突っ切らない）。 */
function wrapAngle(d: number): number {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * 着手マスが「手前・非遮蔽」で見える視点を計算する。
 * カメラをそのマスと同じ側へ回り込ませ（＝マスがカメラと盤中心の間に来る）、
 * ターゲットを少しマス寄りへ寄せて着弾点を画面中央に収める。
 */
function framePose(cell: number, layer: number): { pos: Vector3; target: Vector3 } {
  const [cx, cz] = cellToXZ(cell);
  const len = Math.hypot(cx, cz);
  // 盤中心からの方向（中心セルは存在しないが念のためフォールバック）。
  const dx = len < 0.001 ? 0 : cx / len;
  const dz = len < 0.001 ? 1 : cz / len;
  const pos = new Vector3(dx * FOLLOW_R, FOLLOW_H, dz * FOLLOW_R);
  const target = new Vector3(cx * 0.35, 0.4 + layerY(layer) * 0.3, cz * 0.35);
  return { pos, target };
}

interface CameraControllerProps {
  /** 値が変わるたびにそのビューへアニメーション */
  pendingView: CameraView | null;
  onConsumed: () => void;
  /** 直前着手のカメラ自動追従 ON/OFF */
  followEnabled: boolean;
  /** 追従対象の着手マス（変わるたびに追従）。null なら追従しない */
  followTarget: { cell: number; layer: number } | null;
}

export function CameraController({
  pendingView,
  onConsumed,
  followEnabled,
  followTarget,
}: CameraControllerProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  // 位置は円柱座標（r/theta/h）で補間する＝方位角を回すので、反対側へ行くときも
  // 直線で盤中心を突っ切らず軌道に沿って回り込む。ターゲットは線形補間。
  const anim = useRef<{
    fromTarget: Vector3;
    toTarget: Vector3;
    from: { r: number; theta: number; h: number };
    to: { r: number; theta: number; h: number };
    dTheta: number;
    start: number;
  } | null>(null);

  const beginAnim = (toPos: Vector3, toTarget: Vector3) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const fromTarget = controls.target.clone();
    const from = orbitOf(camera.position, fromTarget);
    const to = orbitOf(toPos, toTarget);
    anim.current = {
      fromTarget,
      toTarget: toTarget.clone(),
      from,
      to,
      dTheta: wrapAngle(to.theta - from.theta),
      start: performance.now(),
    };
  };

  // ビュープリセット(1/2/3)へのアニメーション。
  useEffect(() => {
    if (pendingView == null || !controlsRef.current) return;
    beginAnim(PRESETS[pendingView].clone(), new Vector3(0, 0.4, 0));
    onConsumed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingView, camera, onConsumed]);

  // 直前着手への自動追従（有効時、着手マスが変わるたびに見やすい角度へ）。
  useEffect(() => {
    if (!followEnabled || !followTarget || !controlsRef.current) return;
    const { pos, target } = framePose(followTarget.cell, followTarget.layer);
    beginAnim(pos, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followEnabled, followTarget]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!anim.current || !controls) return;
    const a = anim.current;
    const t = Math.min(1, (performance.now() - a.start) / ANIM_MS);
    const e = easeInOut(t);
    // ターゲットは線形、カメラ位置は円柱座標で補間（方位角を回して軌道に沿わせる）。
    const tx = lerp(a.fromTarget.x, a.toTarget.x, e);
    const ty = lerp(a.fromTarget.y, a.toTarget.y, e);
    const tz = lerp(a.fromTarget.z, a.toTarget.z, e);
    const theta = a.from.theta + a.dTheta * e;
    const r = lerp(a.from.r, a.to.r, e);
    const h = lerp(a.from.h, a.to.h, e);
    camera.position.set(tx + Math.sin(theta) * r, ty + h, tz + Math.cos(theta) * r);
    controls.target.set(tx, ty, tz);
    controls.update();
    if (t >= 1) anim.current = null;
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={false}
      minDistance={4.5}
      maxDistance={20}
      minPolarAngle={0.05}
      maxPolarAngle={Math.PI * 0.49}
      target={[0, 0.4, 0]}
      makeDefault
    />
  );
}

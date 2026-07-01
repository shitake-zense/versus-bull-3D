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

export const DEFAULT_VIEW: CameraView = 2;
const ANIM_MS = 600;
// 追従カメラの軌道半径・高さ（プリセット2と同等の仰角）。
const FOLLOW_R = 7.4;
const FOLLOW_H = 5.4;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

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
  const anim = useRef<{
    fromPos: Vector3;
    toPos: Vector3;
    fromTarget: Vector3;
    toTarget: Vector3;
    start: number;
  } | null>(null);

  const beginAnim = (toPos: Vector3, toTarget: Vector3) => {
    const controls = controlsRef.current;
    if (!controls) return;
    anim.current = {
      fromPos: camera.position.clone(),
      toPos,
      fromTarget: controls.target.clone(),
      toTarget,
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
    camera.position.lerpVectors(a.fromPos, a.toPos, e);
    controls.target.lerpVectors(a.fromTarget, a.toTarget, e);
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

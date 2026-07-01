// OrbitControls + ビュープリセット(1/2/3)切り替え。
// 切り替え時は 600ms かけてカメラ位置とターゲットを lerp する。
// autoRotate=true でゆっくり自動回転（プリセット移動中は自動停止）。

import { useEffect, useRef, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

export type CameraView = 1 | 2 | 3;

// 各プリセットのカメラ位置（ターゲットは常に原点）
const PRESETS: Record<CameraView, Vector3> = {
  1: new Vector3(0, 9.5, 0.001), // トップビュー
  2: new Vector3(0, 5.4, 7.4), // デフォルト（仰角約35°）
  3: new Vector3(8.2, 2.2, 0.5), // ドラマチック（水平寄り）
};

export const DEFAULT_VIEW: CameraView = 2;
const ANIM_MS = 600;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

interface CameraControllerProps {
  /** 値が変わるたびにそのビューへアニメーション */
  pendingView: CameraView | null;
  onConsumed: () => void;
  /** 自動回転（オートオービット）ON/OFF */
  autoRotate: boolean;
}

export function CameraController({ pendingView, onConsumed, autoRotate }: CameraControllerProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  // プリセット移動中は自動回転を止める（lerp と回転が競合しないよう prop で無効化）。
  const [animating, setAnimating] = useState(false);
  const anim = useRef<{
    fromPos: Vector3;
    toPos: Vector3;
    fromTarget: Vector3;
    toTarget: Vector3;
    start: number;
  } | null>(null);

  useEffect(() => {
    if (pendingView == null || !controlsRef.current) return;
    anim.current = {
      fromPos: camera.position.clone(),
      toPos: PRESETS[pendingView].clone(),
      fromTarget: controlsRef.current.target.clone(),
      toTarget: new Vector3(0, 0.4, 0),
      start: performance.now(),
    };
    setAnimating(true);
    onConsumed();
  }, [pendingView, camera, onConsumed]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!anim.current || !controls) return;
    const a = anim.current;
    const t = Math.min(1, (performance.now() - a.start) / ANIM_MS);
    const e = easeInOut(t);
    camera.position.lerpVectors(a.fromPos, a.toPos, e);
    controls.target.lerpVectors(a.fromTarget, a.toTarget, e);
    controls.update();
    if (t >= 1) {
      anim.current = null;
      setAnimating(false);
    }
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
      autoRotate={autoRotate && !animating}
      autoRotateSpeed={0.55}
      makeDefault
    />
  );
}

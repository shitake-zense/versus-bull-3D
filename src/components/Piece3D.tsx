// 1枚のピース。O=マル（リング）、X=バツ（十字）。立方体寄りの厚みを持たせる。
// マウント時に上から落下して着地する（300ms, easeOut）。勝利ライン上は金色に発光。

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, Group, MeshStandardMaterial } from 'three';
import type { StackPiece } from '../types';

const PIECE_HALF_H = 0.16; // 着地時に底面が盤面(y=0)へ接するための半高さ
const LAYER_GAP = 0.42; // 積み重ねの段差
const DROP_FROM = 3.2; // 落下開始の相対高さ
const DROP_MS = 300;

export const layerY = (layer: number) => PIECE_HALF_H + layer * LAYER_GAP;

const PALETTE: Record<StackPiece, { color: string; emissive: string; emissiveBase: number }> = {
  // O=白 / X=黒（モノクロ。発光は無彩色の弱いものだけにして青みを排除）
  o: { color: '#F5F5F5', emissive: '#9aa0ae', emissiveBase: 0.04 },
  x: { color: '#121317', emissive: '#2b2f3a', emissiveBase: 0.05 },
  // b=中立の落下ブロック（隕石）。灰色＋わずかな琥珀の発光。
  b: { color: '#8A93A3', emissive: '#6b5330', emissiveBase: 0.12 },
};

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

interface Piece3DProps {
  position: [number, number]; // [x, z]
  layer: number;
  player: StackPiece;
  winning?: boolean;
  /** 仮置き（自分だけに見えるゴースト）。落下せず半透明で発光 パルスする。 */
  ghost?: boolean;
}

export function Piece3D({ position, layer, player, winning = false, ghost = false }: Piece3DProps) {
  const groupRef = useRef<Group>(null);
  const startRef = useRef<number>(performance.now());
  const targetY = layerY(layer);
  const palette = PALETTE[player];

  const material = useMemo(() => {
    return new MeshStandardMaterial({
      color: new Color(palette.color),
      emissive: new Color(palette.emissive),
      emissiveIntensity: palette.emissiveBase,
      roughness: 0.45,
      metalness: 0.25,
      transparent: ghost,
      opacity: ghost ? 0.45 : 1,
      depthWrite: !ghost,
    });
  }, [palette, ghost]);

  const baseEmissive = useMemo(() => new Color(palette.emissive), [palette]);
  const goldEmissive = useMemo(() => new Color('#FFD700'), []);
  const ghostEmissive = useMemo(() => new Color('#39C7FF'), []);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;

    // 仮置き: 落下させず定位置で発光パルス（実ピースと明確に区別）。
    if (ghost) {
      group.position.y = targetY;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 240);
      material.emissiveIntensity = 0.35 + pulse * 0.6;
      material.emissive.lerp(ghostEmissive, 0.2);
      return;
    }

    const t = Math.min(1, (performance.now() - startRef.current) / DROP_MS);
    group.position.y = targetY + DROP_FROM * (1 - easeOut(t));

    // 勝利時は金発光へ、通常時はベース発光へ滑らかに寄せる。
    const targetIntensity = winning ? 1.5 : palette.emissiveBase;
    material.emissiveIntensity += (targetIntensity - material.emissiveIntensity) * 0.15;
    material.emissive.lerp(winning ? goldEmissive : baseEmissive, 0.15);
  });

  return (
    <group ref={groupRef} position={[position[0], ghost ? targetY : targetY + DROP_FROM, position[1]]}>
      {player === 'o' ? (
        // O = 角ばった四角いリング（実物の白い角マルに合わせて4本のバーで額縁状に）
        <group>
          <mesh material={material} position={[0, 0, 0.27]} castShadow receiveShadow>
            <boxGeometry args={[0.66, 0.3, 0.12]} />
          </mesh>
          <mesh material={material} position={[0, 0, -0.27]} castShadow receiveShadow>
            <boxGeometry args={[0.66, 0.3, 0.12]} />
          </mesh>
          <mesh material={material} position={[0.27, 0, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.12, 0.3, 0.42]} />
          </mesh>
          <mesh material={material} position={[-0.27, 0, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.12, 0.3, 0.42]} />
          </mesh>
        </group>
      ) : player === 'x' ? (
        // X = 太い十字を45°回してバツに（実物の赤バツに合わせた形）
        <group rotation={[0, Math.PI / 4, 0]}>
          <mesh material={material} castShadow receiveShadow>
            <boxGeometry args={[0.7, 0.3, 0.2]} />
          </mesh>
          <mesh material={material} castShadow receiveShadow>
            <boxGeometry args={[0.2, 0.3, 0.7]} />
          </mesh>
        </group>
      ) : (
        // b = 中立の落下ブロック（隕石）。ゴツゴツした灰色の多面体。
        <mesh material={material} castShadow receiveShadow>
          <icosahedronGeometry args={[0.36, 0]} />
        </mesh>
      )}
    </group>
  );
}

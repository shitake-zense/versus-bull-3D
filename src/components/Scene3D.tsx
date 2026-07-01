// @react-three/fiber Canvas ラッパー。ライティング・ボード・カメラ・勝利ライトを束ねる。

import { Canvas } from '@react-three/fiber';
import { Vector3 } from 'three';
import type { Board, Player, Trap, WinLine } from '../types';
import { Board3D, cellToXZ } from './Board3D';
import { CameraController, type CameraView } from './CameraController';
import { layerY } from './Piece3D';

interface Scene3DProps {
  board: Board;
  /** 落下ブロックの予告位置。未発動のものを予告マーカーで表示する。 */
  traps: Trap[];
  winLine: WinLine | null;
  canPlace: boolean;
  currentTurn: Player;
  lastMove: { cell: number; layer: number } | null;
  threats: { cell: number; layer: number }[];
  pendingView: CameraView | null;
  onViewConsumed: () => void;
  onCellClick: (cell: number) => void;
}

export function Scene3D(props: Scene3DProps) {
  const { board, winLine } = props;

  // 勝利ライン中央の発光ライト位置
  const winLightPos = winLine
    ? (() => {
        const c = new Vector3();
        winLine.coords.forEach((co) => {
          const [x, z] = cellToXZ(co.cell);
          c.add(new Vector3(x, layerY(co.layer) + 0.4, z));
        });
        return c.multiplyScalar(1 / winLine.coords.length);
      })()
    : null;

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 5.4, 7.4], fov: 45, near: 0.1, far: 100 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={['#1C4A6E']} />
      <fog attach="fog" args={['#1C4A6E', 16, 30]} />

      <ambientLight intensity={0.4} />
      <directionalLight
        intensity={1.2}
        position={[5, 10, 5]}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
      />
      <pointLight intensity={0.6} position={[-3, 6, -3]} />

      {winLightPos && (
        <pointLight
          position={[winLightPos.x, winLightPos.y, winLightPos.z]}
          intensity={3}
          distance={6}
          color="#FFD700"
        />
      )}

      <Board3D
        board={board}
        traps={props.traps}
        winLine={winLine}
        canPlace={props.canPlace}
        currentTurn={props.currentTurn}
        lastMove={props.lastMove}
        threats={props.threats}
        onCellClick={props.onCellClick}
      />

      <CameraController pendingView={props.pendingView} onConsumed={props.onViewConsumed} />
    </Canvas>
  );
}

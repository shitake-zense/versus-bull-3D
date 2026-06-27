// ボード面・グリッド・ピース群・ホバープレビュー・クリック判定を描画する。

import { useMemo, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type { Board, Player, WinLine } from '../types';
import { BOARD_DIM, CELL_COUNT } from '../lib/gameLogic';
import { Piece3D, layerY } from './Piece3D';

const CELL = 1; // 1マスの一辺
const HALF = (BOARD_DIM - 1) / 2; // 中央寄せ用 (1.5)

/** cellIndex → ワールド座標 [x, z] */
export function cellToXZ(cellIndex: number): [number, number] {
  const row = Math.floor(cellIndex / BOARD_DIM);
  const col = cellIndex % BOARD_DIM;
  return [(col - HALF) * CELL, (row - HALF) * CELL];
}

interface Board3DProps {
  board: Board;
  winLine: WinLine | null;
  canPlace: boolean;
  currentTurn: Player;
  onCellClick: (cell: number) => void;
}

export function Board3D({ board, winLine, canPlace, currentTurn, onCellClick }: Board3DProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  const winSet = useMemo(() => {
    if (!winLine) return null;
    return new Set(winLine.coords.map((co) => `${co.cell}-${co.layer}`));
  }, [winLine]);

  return (
    <group>
      {/* ボード台座（中間グレー: 白O・黒X 双方が映える） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[BOARD_DIM + 0.4, BOARD_DIM + 0.4]} />
        <meshStandardMaterial color="#878E9D" roughness={0.8} metalness={0.1} />
      </mesh>

      {/* グリッド線 */}
      <gridHelper args={[BOARD_DIM, BOARD_DIM, '#2a2e38', '#2a2e38']} position={[0, 0.001, 0]}>
        <lineBasicMaterial attach="material" color="#2a2e38" transparent opacity={0.7} />
      </gridHelper>

      {/* ピース */}
      {board.map((stack, cell) => {
        const [x, z] = cellToXZ(cell);
        return stack.map((player, layer) => (
          <Piece3D
            key={`${cell}-${layer}`}
            position={[x, z]}
            layer={layer}
            player={player}
            winning={winSet?.has(`${cell}-${layer}`) ?? false}
          />
        ));
      })}

      {/* ホバープレビュー（白リング） */}
      {canPlace && hovered !== null && (
        <mesh
          position={[cellToXZ(hovered)[0], layerY(board[hovered].length), cellToXZ(hovered)[1]]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <torusGeometry args={[0.42, 0.03, 12, 40]} />
          <meshStandardMaterial
            color={currentTurn === 'o' ? '#ffffff' : '#5a6072'}
            emissive="#ffffff"
            emissiveIntensity={0.6}
            transparent
            opacity={0.7}
          />
        </mesh>
      )}

      {/* クリック判定用の透明プレーン（各マス） */}
      {Array.from({ length: CELL_COUNT }, (_, cell) => {
        const [x, z] = cellToXZ(cell);
        return (
          <mesh
            key={`hit-${cell}`}
            position={[x, 0.01, z]}
            rotation={[-Math.PI / 2, 0, 0]}
            onPointerOver={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              if (canPlace) setHovered(cell);
            }}
            onPointerOut={() => setHovered((h) => (h === cell ? null : h))}
            onClick={(e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              if (canPlace) onCellClick(cell);
            }}
          >
            <planeGeometry args={[CELL, CELL]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        );
      })}
    </group>
  );
}

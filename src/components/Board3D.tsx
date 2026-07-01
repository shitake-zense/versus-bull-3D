// ボード面・グリッド・ピース群・ホバープレビュー・クリック判定を描画する。

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { Group } from 'three';
import type { Board, Player, Trap, WinLine } from '../types';
import { BOARD_DIM, CELL_COUNT, MAX_STACK, isBlock } from '../lib/gameLogic';
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
  /** 落下ブロックの予告位置。未発動のものを予告マーカーで表示する。 */
  traps: Trap[];
  winLine: WinLine | null;
  canPlace: boolean;
  currentTurn: Player;
  /** 相手が直前に置いたピース（強調表示用）。 */
  lastMove: { cell: number; layer: number } | null;
  /** 相手が次に4連を作れるマス（リーチ警告）。着地層も含む。 */
  threats: { cell: number; layer: number }[];
  onCellClick: (cell: number) => void;
}

export function Board3D({
  board,
  traps,
  winLine,
  canPlace,
  currentTurn,
  lastMove,
  threats,
  onCellClick,
}: Board3DProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  // 仮置きしているマス（1回目のクリックで設定、同じマスを再クリックで確定）。
  const [tentative, setTentative] = useState<number | null>(null);
  // まだ発動していない（＝その層がブロックで埋まっていない）予告のみ表示する。
  const pendingTraps = useMemo(
    () => traps.filter((t) => !isBlock(board[t.cell]?.[t.layer] ?? null)),
    [traps, board],
  );

  // 自分の手番でなくなったら、または盤面が変わったら仮置きを破棄する。
  useEffect(() => {
    if (!canPlace) setTentative(null);
  }, [canPlace]);
  useEffect(() => {
    setTentative(null);
  }, [board]);

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

      {/* 落下ブロックの予告マーカー（未発動のみ・勝利演出中は出さない）。 */}
      {!winLine &&
        pendingTraps.map((t) => (
          <TrapTelegraph key={`trap-${t.cell}`} cell={t.cell} layer={t.layer} />
        ))}

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

      {/* 仮置きピース（自分だけに見えるゴースト。確定前なので相手には未送信） */}
      {canPlace && tentative !== null && (
        <Piece3D
          key={`ghost-${tentative}-${board[tentative].length}`}
          position={cellToXZ(tentative)}
          layer={board[tentative].length}
          player={currentTurn}
          ghost
        />
      )}

      {/* 相手が直前に置いたピースの強調マーカー（勝利演出中は出さない） */}
      {lastMove && !winLine && (
        <LastMoveMarker cell={lastMove.cell} layer={lastMove.layer} />
      )}

      {/* リーチ警告マーカー（相手が次に4連を作れる着地マスを赤リングで） */}
      {!winLine &&
        threats.map((t) => (
          <ThreatMarker key={`threat-${t.cell}`} cell={t.cell} layer={t.layer} />
        ))}

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
        const disabled = board[cell].length >= MAX_STACK; // 満杯マスは着手不可
        return (
          <mesh
            key={`hit-${cell}`}
            position={[x, 0.01, z]}
            rotation={[-Math.PI / 2, 0, 0]}
            onPointerOver={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              if (canPlace && !disabled) setHovered(cell);
            }}
            onPointerOut={() => setHovered((h) => (h === cell ? null : h))}
            onClick={(e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              if (!canPlace || disabled) return;
              // 2クリック制: 1回目は仮置き、同じマスの2回目で確定。
              // 別マスをクリックした場合は仮置きをそのマスへ移動する。
              if (tentative === cell) {
                onCellClick(cell);
                setTentative(null);
              } else {
                setTentative(cell);
              }
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

/**
 * 落下ブロックの予告。降ってくる (cell, layer) にゴースト球体＋明滅する琥珀リングと
 * 上向きの落下チェブロンを表示。1個下が埋まると中立ブロックが降る、と予告する。
 */
function TrapTelegraph({ cell, layer }: { cell: number; layer: number }) {
  const ref = useRef<Group>(null);
  const ghostRef = useRef<Group>(null);
  const [x, z] = cellToXZ(cell);
  const y = layerY(layer);

  useFrame(() => {
    const t = performance.now() / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    if (ref.current) {
      const s = 1 + 0.05 * pulse;
      ref.current.scale.set(s, 1, s);
    }
    // ゴースト球体はゆっくり上下に漂う＝「降ってくる」予感。
    if (ghostRef.current) ghostRef.current.position.y = 0.08 * Math.sin(t * 2);
  });

  return (
    <group position={[x, y, z]}>
      {/* 着地位置を示す琥珀リング（水平・控えめ） */}
      <group ref={ref}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.44, 0.03, 12, 40]} />
          <meshStandardMaterial
            color="#FFB020"
            emissive="#FFB020"
            emissiveIntensity={0.5}
            transparent
            opacity={0.4}
          />
        </mesh>
      </group>
      {/* 降ってくる中立ブロックのゴースト（半透明の岩） */}
      <group ref={ghostRef}>
        <mesh>
          <icosahedronGeometry args={[0.26, 0]} />
          <meshStandardMaterial
            color="#B9C0CC"
            emissive="#FFB020"
            emissiveIntensity={0.12}
            roughness={0.9}
            metalness={0.1}
            transparent
            opacity={0.22}
          />
        </mesh>
      </group>
      {/* 落下方向を示す下向きチェブロン（上方に配置・控えめ） */}
      <mesh position={[0, 0.5, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.1, 0.18, 4]} />
        <meshStandardMaterial
          color="#FFB020"
          emissive="#FFB020"
          emissiveIntensity={0.4}
          transparent
          opacity={0.5}
        />
      </mesh>
    </group>
  );
}

/** リーチ警告。相手が次に置けば4連になる着地マスを、明滅する赤リングで示す。 */
function ThreatMarker({ cell, layer }: { cell: number; layer: number }) {
  const ref = useRef<Group>(null);
  const [x, z] = cellToXZ(cell);
  const y = layerY(layer);

  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const t = performance.now() / 260;
    const s = 1 + 0.12 * Math.sin(t);
    m.scale.set(s, s, s);
  });

  return (
    <group ref={ref} position={[x, y, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.44, 0.055, 12, 36]} />
        <meshStandardMaterial
          color="#FF3B30"
          emissive="#FF3B30"
          emissiveIntensity={1.4}
          transparent
          opacity={0.85}
        />
      </mesh>
    </group>
  );
}

/** 直前の着手を指し示す、ピース上部で明滅・上下するマゼンタのリング＋下向き矢印。 */
function LastMoveMarker({ cell, layer }: { cell: number; layer: number }) {
  const ref = useRef<Group>(null);
  const [x, z] = cellToXZ(cell);
  const baseY = layerY(layer) + 0.5;

  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const t = performance.now() / 320;
    const s = 1 + 0.16 * Math.sin(t);
    m.scale.set(s, s, s);
    m.position.y = baseY + 0.06 * Math.sin(t);
  });

  return (
    <group ref={ref} position={[x, baseY, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.34, 0.05, 12, 36]} />
        <meshStandardMaterial
          color="#FF4FB0"
          emissive="#FF4FB0"
          emissiveIntensity={1.5}
          transparent
          opacity={0.9}
        />
      </mesh>
      <mesh position={[0, 0.26, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.13, 0.22, 4]} />
        <meshStandardMaterial
          color="#FF4FB0"
          emissive="#FF4FB0"
          emissiveIntensity={1.5}
        />
      </mesh>
    </group>
  );
}

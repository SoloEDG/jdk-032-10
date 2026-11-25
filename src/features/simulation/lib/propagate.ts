import type { DominoDocument, Piece, SimulationEvent } from '@/shared/document'
import type { ParameterVector } from '@/shared/calibration'
import { nextContact } from '@/features/layout/lib/geometry'

interface PropagateOptions {
  candidate?: ParameterVector | null
}

const REFERENCE_GROUND_FRICTION = 0.48

interface Scheduled {
  pieceId: string
  time: number
  causeId: string | null
  detail: string
}

export function propagate(document: DominoDocument, options: PropagateOptions = {}) {
  const candidate = options.candidate ?? null
  const ground = document.calibration?.grounds.find(item => item.id === document.scene.groundId)
  const nominalGroundFriction = ground?.friction ?? document.scene.friction
  const queue: Scheduled[] = [{ pieceId: document.startPieceId, time: 0, causeId: null, detail: '手动触发' }]
  const fallen = new Set<string>()
  const events: SimulationEvent[] = []
  let interruptedPieceId: string | null = null
  let interruptionReason: string | null = null
  let reachedTrigger = false

  while (queue.length && events.length < document.pieces.length * 3) {
    queue.sort((a, b) => a.time - b.time || a.pieceId.localeCompare(b.pieceId) || (a.causeId ?? '').localeCompare(b.causeId ?? ''))
    const next = queue.shift()!
    const piece = document.pieces.find(item => item.id === next.pieceId)
    if (!piece || fallen.has(piece.id)) continue

    if (piece.kind === 'trigger') {
      const event: SimulationEvent = {
        id: `event-${events.length + 1}`, pieceId: piece.id, time: next.time,
        causeId: next.causeId, kind: 'mechanism', detail: `触发器响应 · ${next.detail}`,
      }
      events.push(event)
      reachedTrigger = true
      for (const link of document.connections.filter(link => link.from === piece.id && link.enabled)) {
        queue.push({ pieceId: link.to, time: next.time + link.delay, causeId: event.id, detail: '机关连线' })
      }
      continue
    }

    fallen.add(piece.id)
    const event: SimulationEvent = {
      id: `event-${events.length + 1}`, pieceId: piece.id, time: next.time,
      causeId: next.causeId, kind: piece.kind === 'splitter' ? 'mechanism' : 'fall',
      detail: piece.kind === 'splitter' ? `分岔展开 · ${next.detail}`
        : piece.kind === 'ramp' ? `坡道传递 · ${next.detail}` : `受力倒下 · ${next.detail}`,
    }
    events.push(event)

    for (const link of document.connections.filter(link => link.from === piece.id && link.enabled)) {
      queue.push({ pieceId: link.to, time: next.time + link.delay, causeId: event.id, detail: '机关连线' })
    }

    const available = document.pieces.filter(item => !fallen.has(item.id) && item.id !== piece.id)
    let surfaceGrip: number
    let reachScale: number
    let contactAngle = 47
    let speedFactor = 0.75

    if (candidate) {
      const fittedGroundMu = Math.max(0.05, Math.min(1.4,
        candidate.groundFriction * nominalGroundFriction / REFERENCE_GROUND_FRICTION))
      surfaceGrip = (fittedGroundMu + candidate.pieceFriction) / 2
      const maxReach = piece.height * (1.02 + 0.34 * surfaceGrip - 0.16 * piece.fallThreshold)
        + candidate.reachMargin
      reachScale = maxReach / (piece.height * 1.18)
      contactAngle = 54
      speedFactor = 0.56 + 0.42 * surfaceGrip - 0.16 * piece.fallThreshold
    } else {
      surfaceGrip = (document.scene.friction + piece.friction) / 2
      reachScale = (0.94 + surfaceGrip * 0.35) * (1.25 - piece.fallThreshold * 0.25)
      speedFactor = 0.75 + surfaceGrip * 0.5
    }

    let target: Piece | null = null
    if (piece.kind === 'ramp') {
      target = available.filter(item => item.x > piece.x && Math.abs(item.y - piece.y) < 2.1)
        .sort((a, b) => a.x - b.x || a.id.localeCompare(b.id))[0] ?? null
    } else {
      target = nextContact(piece, available, reachScale, contactAngle)
    }
    if (target) {
      const separation = Math.hypot(piece.x - target.x, piece.y - target.y)
      const speed = candidate
        ? Math.max(1.7, piece.height * document.scene.gravity / 2 * speedFactor)
        : Math.max(1.8, piece.height * document.scene.gravity / 2) * speedFactor
      const travel = Math.max(0.12, candidate ? 0.105 + 0.055 * target.fallThreshold + separation / speed : Math.max(0.24, separation / speed))
      queue.push({
        pieceId: target.id, time: next.time + travel, causeId: event.id,
        detail: piece.kind === 'splitter' ? '分岔臂接触' : piece.kind === 'ramp' ? '坡面末端接触' : '相邻接触',
      })
    }

    const hasConnection = document.connections.some(link => link.from === piece.id && link.enabled)
    if (!target && !hasConnection && interruptedPieceId === null) {
      interruptedPieceId = piece.id
      interruptionReason = '倒下方向内没有可触达的元件，链路在此停止。'
      events.push({
        id: `event-${events.length + 1}`, pieceId: piece.id, time: next.time + 0.05,
        causeId: event.id, kind: 'interrupted', detail: interruptionReason,
      })
    }
  }

  return {
    events,
    interruptedPieceId,
    interruptionReason,
    reachedTrigger,
    status: events.length === 0 ? 'empty' as const
      : interruptedPieceId || !reachedTrigger ? 'interrupted' as const : 'complete' as const,
    duration: events.at(-1)?.time ?? 0,
  }
}

import type {
  CalibrationSample,
  GroundSurface,
  ParameterVector,
} from '@/shared/calibration'

const GRAVITY = 9.8
const REFERENCE_GROUND_FRICTION = 0.48
const CONTACT_ANGLE_LIMIT = 54

export interface ContactTime {
  targetId: string
  group: string
  face: 'A' | 'B'
  time: number
  fromId: string
}

export interface SamplePrediction {
  order: string[]
  complete: boolean
  winner: 'A' | 'B' | null
  contactTimes: ContactTime[]
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function forwardVector(angle: number) {
  const radians = angle * Math.PI / 180
  return { x: Math.cos(radians), y: Math.sin(radians) }
}

function angleBetween(a: { x: number; y: number }, b: { x: number; y: number }) {
  const denominator = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y)
  if (!denominator) return 180
  const cosine = Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / denominator))
  return Math.acos(cosine) * 180 / Math.PI
}

export function effectiveGrip(ground: GroundSurface | undefined, params: ParameterVector) {
  // The sampled ground card supplies a relative texture multiplier. The fitted
  // groundFriction coordinate is expressed as equivalent clear-oak friction.
  const nominal = ground?.friction ?? REFERENCE_GROUND_FRICTION
  const groundMu = Math.max(0.05, Math.min(1.4,
    params.groundFriction * nominal / REFERENCE_GROUND_FRICTION))
  return (groundMu + params.pieceFriction) / 2
}

export function contactBudget(params: ParameterVector, grip: number, height = 1.6, threshold = 0.8) {
  return params.reachMargin + height * (0.34 * grip - 0.16 * threshold)
}

export function predictSample(
  sample: CalibrationSample,
  ground: GroundSurface | undefined,
  params: ParameterVector,
): SamplePrediction {
  const nodes = new Map(sample.nodes.map(node => [node.id, node]))
  const grip = effectiveGrip(ground, params)
  const queue = new Map<string, { time: number; causeId: string | null }>()
  const fallen: string[] = []
  const contactTimes: ContactTime[] = []

  if (!nodes.has(sample.startId)) {
    return { order: [], complete: false, winner: null, contactTimes: [] }
  }
  queue.set(sample.startId, { time: 0, causeId: null })

  let guard = 0
  while (queue.size && guard++ < sample.nodes.length * 12 + 40) {
    let currentId: string | null = null
    let currentTime = Infinity
    for (const [id, event] of queue) {
      if (event.time < currentTime - 1e-9
        || (Math.abs(event.time - currentTime) <= 1e-9 && (currentId === null || id < currentId))) {
        currentId = id
        currentTime = event.time
      }
    }
    if (!currentId) break

    const event = queue.get(currentId)!
    queue.delete(currentId)
    if (fallen.includes(currentId)) continue

    const source = nodes.get(currentId)
    if (!source) continue
    fallen.push(currentId)

    const facing = forwardVector(source.angle)
    const slope = ground?.slope ?? 0

    for (const target of sample.nodes) {
      if (fallen.includes(target.id)) continue

      const delta = { x: target.x - source.x, y: target.y - source.y }
      const alignment = angleBetween(facing, delta)
      if (alignment > CONTACT_ANGLE_LIMIT) continue

      const separation = distance(source, target)
      const maxReach = source.height * (1.02 + 0.34 * grip - 0.16 * source.fallThreshold)
        + params.reachMargin
      if (separation > maxReach) continue

      const speed = Math.max(
        1.7,
        source.height * GRAVITY / 2
          * (0.56 + 0.42 * grip - 0.16 * source.fallThreshold + 0.006 * slope),
      )
      const faceLead = source.contactFace
        ? (source.contactFace === 'A' ? -params.faceLead : params.faceLead)
        : 0
      const delay = 0.105 + 0.055 * target.fallThreshold + separation / speed + faceLead
      const time = event.time + delay

      if (target.faceGroup && source.contactFace) {
        contactTimes.push({
          targetId: target.id,
          group: target.faceGroup,
          face: source.contactFace,
          time,
          fromId: source.id,
        })
      }

      const previous = queue.get(target.id)
      if (!previous
        || time < previous.time - 1e-9
        || (Math.abs(time - previous.time) <= 1e-9 && target.id < (previous.causeId ?? '~'))) {
        queue.set(target.id, { time, causeId: currentId })
      }
    }
  }

  const earliestByGroup = new Map<string, ContactTime>()
  for (const contact of contactTimes) {
    const previous = earliestByGroup.get(contact.group)
    if (!previous || contact.time < previous.time - 1e-9
      || (Math.abs(contact.time - previous.time) <= 1e-9 && contact.face < previous.face)) {
      earliestByGroup.set(contact.group, contact)
    }
  }

  return {
    order: fallen,
    complete: fallen.length === sample.nodes.length,
    winner: earliestByGroup.get('merge')?.face ?? null,
    contactTimes,
  }
}

export function orderMatches(order: readonly string[], tiers: readonly string[][]) {
  const expected = tiers.flat()
  return order.length === expected.length
    && order.every((id, index) => id === expected[index])
}

export function parseOrderText(text: string): string[][] {
  return text
    .replace(/，/g, ',')
    .replace(/,/g, '>')
    .split('>')
    .map(tier => tier
      .split('=')
      .map(id => id.trim())
      .filter(Boolean))
    .filter(tier => tier.length > 0)
}

export function orderToText(tiers: readonly string[][]) {
  return tiers.map(tier => tier.join('=')).join(' > ')
}

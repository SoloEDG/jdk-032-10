export type CalibrationRole = 'calibration' | 'holdout'
export type ParameterKey = 'groundFriction' | 'pieceFriction' | 'reachMargin' | 'faceLead'
export type ContactFace = 'A' | 'B'

export type ParameterVector = Record<ParameterKey, number>

export interface GroundSurface {
  id: string
  name: string
  /** Nominal dynamic friction coefficient from the surface card. */
  friction: number
  /** Signed slope in degrees along the test chain. */
  slope: number
  note: string
}

export interface CalibrationDimensions {
  /** Recorded nominal centre spacing, metres. */
  spacing: number
  pieceHeight: number
  pieceWidth: number
  /** Manual placement tolerance, metres. */
  tolerance: number
}

export interface CalibrationNode {
  id: string
  label: string
  kind: 'domino' | 'splitter' | 'ramp' | 'trigger'
  x: number
  y: number
  angle: number
  height: number
  width: number
  fallThreshold: number
  /** Edge/face that reaches a shared contact group. */
  contactFace?: ContactFace
  faceGroup?: string
}

export interface CalibrationSample {
  id: string
  name: string
  role: CalibrationRole
  groundId: string
  startId: string
  dimensions: CalibrationDimensions
  /** Sample-level recorded tipping threshold; copied to nodes in the seeded data. */
  fallThreshold: number
  nodes: CalibrationNode[]
  /** Ordered tiers. A tier may contain several IDs observed in the same frame. */
  observedTiers: string[][]
  status: 'observed' | 'pending'
  note: string
  builtIn?: boolean
}

export interface CalibrationState {
  schemaVersion: 1
  grounds: GroundSurface[]
  samples: CalibrationSample[]
  holdoutId: string
  selectedSampleId: string | null
}

export type IdentifiabilityLevel = 'joint' | 'weak' | 'none' | 'infeasible'

export interface ParameterRange {
  key: ParameterKey
  label: string
  min: number
  max: number
  priorMin: number
  priorMax: number
  unit: '' | 'm' | 's'
  step: number
  level: IdentifiabilityLevel
  /** Fraction of the prior interval removed by the feasible ensemble. */
  narrowing: number
  hint: string
}

export interface JointConstraint {
  key: string
  label: string
  min: number
  max: number
  priorMin: number
  priorMax: number
  unit: '' | 'm'
  formula: string
  narrowing: number
}

export interface ParameterCorrelation {
  x: ParameterKey
  y: ParameterKey
  xLabel: string
  yLabel: string
  r: number
  relation: 'positive' | 'negative' | 'independent'
}

export interface GroundFrictionRange {
  groundId: string
  name: string
  min: number
  max: number
  priorMin: number
  priorMax: number
}

export interface SampleFitStat {
  sampleId: string
  name: string
  role: CalibrationRole
  groundId: string
  matchCount: number
  gridSize: number
  matchFraction: number
  budgetMin: number | null
  budgetMax: number | null
  note: string
}

export interface HoldoutVerdict {
  sampleId: string
  name: string
  feasibleCount: number
  aCount: number
  bCount: number
  unresolvedCount: number
  completeCount: number
  aFraction: number
  bFraction: number
  unresolvedFraction: number
  opposite: boolean
  consensus: boolean
  majority: ContactFace | 'unresolved' | 'split'
  aWitness: ParameterVector | null
  bWitness: ParameterVector | null
  observedOrderChecked: boolean
  observedMatchCount: number
  observedMatchFraction: number | null
}

export interface CalibrationFit {
  schemaVersion: 1
  fitId: string
  fittedAt: number
  signature: string
  gridSize: number
  feasibleCount: number
  ranges: ParameterRange[]
  groundFrictionRanges: GroundFrictionRange[]
  jointConstraints: JointConstraint[]
  correlations: ParameterCorrelation[]
  sampleStats: SampleFitStat[]
  holdout: HoldoutVerdict
  /** A small set of real feasible vectors, never a fabricated "average". */
  representatives: ParameterVector[]
  selectedCandidate: ParameterVector
  warning: string
}

export interface CalibrationRunSnapshot {
  schemaVersion: 1
  fitId: string
  fittedAt: number
  signature: string
  calibrationSamples: { id: string; name: string }[]
  holdout: { id: string; name: string }
  feasibleCount: number
  gridSize: number
  selectedCandidate: ParameterVector
  ranges: ParameterRange[]
  jointConstraints: JointConstraint[]
  correlations: ParameterCorrelation[]
  holdoutSummary: Pick<HoldoutVerdict,
    'aFraction' | 'bFraction' | 'unresolvedFraction' | 'opposite' | 'consensus' | 'majority'>
  warning: string
}

const commonDimensions = (spacing: number): CalibrationDimensions => ({
  spacing,
  pieceHeight: 1.6,
  pieceWidth: 0.42,
  tolerance: 0.03,
})

function straightNodes(prefix: string, count: number, x0: number, gap: number, y: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${index + 1}`,
    label: `${prefix.toUpperCase()}-${index + 1}`,
    kind: 'domino' as const,
    x: Math.round((x0 + index * gap) * 100) / 100,
    y,
    angle: 0,
    height: 1.6,
    width: 0.42,
    fallThreshold: 0.8,
  }))
}

export function createDefaultGrounds(): GroundSurface[] {
  return [
    { id: 'oak', name: '清漆木桌', friction: 0.48, slope: 0, note: '反光清漆，木纹方向与链轴平行' },
    { id: 'felt', name: '亚麻台垫', friction: 0.66, slope: 0, note: '短绒亚麻，边缘有轻微吸能' },
    { id: 'rubber', name: '细砂橡胶垫', friction: 0.82, slope: 0, note: '高握持，用于旁路诱饵样本' },
    { id: 'ramp11', name: '11° 顺坡木面', friction: 0.44, slope: 11, note: '坡面汇合样本，顺链方向下坡' },
  ]
}

export function createDefaultCalibrationState(): CalibrationState {
  const straight = (
    id: string,
    name: string,
    groundId: string,
    gap: number,
    count: number,
    note: string,
  ): CalibrationSample => ({
    id,
    name,
    role: 'calibration',
    groundId,
    startId: `${id.replace('sample-', 's')}1`,
    dimensions: commonDimensions(gap),
    fallThreshold: 0.8,
    nodes: straightNodes(`${id.replace('sample-', 's')}`, count, 1, gap, 4),
    observedTiers: Array.from({ length: count }, (_, index) => [`s${id.slice(-1)}${index + 1}`]),
    status: 'observed',
    note,
    builtIn: true,
  })

  const sample1 = straight('sample-1', '直线密排', 'oak', 1.35, 5, '所有组合都能完成，只确认触发方向。')
  sample1.startId = 'a1'
  sample1.nodes = straightNodes('a', 5, 1, 1.35, 4)
  sample1.observedTiers = [['a1'], ['a2'], ['a3'], ['a4'], ['a5']]

  const sample2 = straight('sample-2', '直线临界间距', 'oak', 1.82, 5, '给出最低接触预算，但摩擦与触发距离可互相补偿。')
  sample2.startId = 'b1'
  sample2.nodes = straightNodes('b', 5, 1, 1.82, 4)
  sample2.observedTiers = [['b1'], ['b2'], ['b3'], ['b4'], ['b5']]

  const sample3: CalibrationSample = {
    id: 'sample-3',
    name: '旁路诱饵',
    role: 'calibration',
    groundId: 'rubber',
    startId: 'c1',
    dimensions: commonDimensions(1.55),
    fallThreshold: 0.8,
    nodes: [
      ...straightNodes('c', 4, 1, 1.55, 4),
      {
        id: 'decoy', label: '诱饵', kind: 'domino', x: 2.7, y: 5.25, angle: -35,
        height: 1.6, width: 0.42, fallThreshold: 0.8,
      },
    ],
    observedTiers: [['c1'], ['c2'], ['c3'], ['c4']],
    status: 'observed',
    note: '过大的接触预算会把诱饵提前卷入顺序。',
    builtIn: true,
  }

  const sample4: CalibrationSample = {
    id: 'sample-4',
    name: '坡面汇合',
    role: 'calibration',
    groundId: 'ramp11',
    startId: 'j0',
    dimensions: { spacing: 1.6, pieceHeight: 1.6, pieceWidth: 0.42, tolerance: 0.04 },
    fallThreshold: 0.8,
    nodes: [
      { id: 'j0', label: '分流起点', kind: 'splitter', x: 1, y: 4, angle: 0, height: 1.5, width: 0.75, fallThreshold: 0.75 },
      { id: 'l1', label: '左坡-1', kind: 'domino', x: 2.35, y: 4.88, angle: 24, height: 1.6, width: 0.42, fallThreshold: 0.8 },
      { id: 'u1', label: '右坡-1', kind: 'domino', x: 2.35, y: 3.12, angle: -24, height: 1.6, width: 0.42, fallThreshold: 0.8 },
      { id: 'l2', label: '左坡-2', kind: 'domino', x: 3.95, y: 5.28, angle: 8, height: 1.6, width: 0.42, fallThreshold: 0.8 },
      { id: 'u2', label: '右坡-2', kind: 'domino', x: 3.95, y: 2.72, angle: -8, height: 1.6, width: 0.42, fallThreshold: 0.8 },
      { id: 'l3', label: '左坡-3', kind: 'domino', x: 5.55, y: 4.82, angle: -24, height: 1.6, width: 0.42, fallThreshold: 0.8 },
      { id: 'u3', label: '右坡-3', kind: 'domino', x: 5.55, y: 3.18, angle: 24, height: 1.6, width: 0.42, fallThreshold: 0.8 },
      { id: 'm', label: '汇合件', kind: 'domino', x: 6.75, y: 4, angle: 0, height: 1.7, width: 0.5, fallThreshold: 0.8 },
    ],
    observedTiers: [['j0'], ['l1'], ['u1'], ['l2'], ['u2'], ['l3'], ['u3'], ['m']],
    status: 'observed',
    note: '两条坡线的汇合顺序限制过早远程接触。',
    builtIn: true,
  }

  const holdout: CalibrationSample = {
    id: 'holdout-fork',
    name: '保留：双面分岔链',
    role: 'holdout',
    groundId: 'oak',
    startId: 'f1',
    dimensions: { spacing: 1.55, pieceHeight: 1.6, pieceWidth: 0.42, tolerance: 0.025 },
    fallThreshold: 0.8,
    nodes: [
      { id: 'f1', label: '手推起点', kind: 'domino', x: 1, y: 4, angle: 0, height: 1.6, width: 0.42, fallThreshold: 0.8 },
      { id: 'sp', label: '分岔件', kind: 'splitter', x: 2.35, y: 4, angle: 0, height: 1.5, width: 0.75, fallThreshold: 0.75 },
      { id: 'u1', label: 'A-1', kind: 'domino', x: 3.55, y: 3.05, angle: -18, height: 1.6, width: 0.42, fallThreshold: 0.8 },
      { id: 'u2', label: 'A-2', kind: 'domino', x: 5.25, y: 2.72, angle: 0, height: 1.6, width: 0.42, fallThreshold: 0.8 },
      { id: 'u3', label: 'A-长臂', kind: 'domino', x: 6.95, y: 3.35, angle: 28, height: 1.6, width: 0.42, fallThreshold: 0.8, contactFace: 'A' },
      { id: 'l1', label: 'B-1', kind: 'domino', x: 3.55, y: 4.95, angle: 18, height: 1.6, width: 0.42, fallThreshold: 0.8 },
      { id: 'l2', label: 'B-2', kind: 'domino', x: 5.2, y: 5.28, angle: 0, height: 1.6, width: 0.42, fallThreshold: 0.8 },
      { id: 'l3', label: 'B-3', kind: 'domino', x: 6.75, y: 5.08, angle: -12, height: 1.6, width: 0.42, fallThreshold: 0.8 },
      { id: 'l4', label: 'B-短臂', kind: 'domino', x: 7.95, y: 4.62, angle: -30, height: 1.6, width: 0.42, fallThreshold: 0.8, contactFace: 'B' },
      { id: 'm', label: '双面汇合', kind: 'domino', x: 8.55, y: 4, angle: 0, height: 1.7, width: 0.55, fallThreshold: 0.8, faceGroup: 'merge' },
    ],
    observedTiers: [],
    status: 'pending',
    note: '此链不参与拟合；用来检查 A/B 两面谁先接触。可在实测后补填顺序。',
    builtIn: true,
  }

  return {
    schemaVersion: 1,
    grounds: createDefaultGrounds(),
    samples: [sample1, sample2, sample3, sample4, holdout],
    holdoutId: holdout.id,
    selectedSampleId: sample1.id,
  }
}

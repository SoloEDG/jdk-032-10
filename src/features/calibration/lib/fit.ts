import type {
  CalibrationFit,
  CalibrationRunSnapshot,
  CalibrationState,
  GroundFrictionRange,
  HoldoutVerdict,
  JointConstraint,
  ParameterCorrelation,
  ParameterKey,
  ParameterRange,
  ParameterVector,
  SampleFitStat,
} from '@/shared/calibration'
import { contactBudget, effectiveGrip, orderMatches, predictSample } from './predict'

const REFERENCE_GROUND_FRICTION = 0.48

export const PARAM_SPECS: {
  key: ParameterKey
  label: string
  min: number
  max: number
  step: number
  unit: ParameterRange['unit']
  hint: string
}[] = [
  {
    key: 'groundFriction',
    label: '地面摩擦 μ',
    min: 0.2,
    max: 0.8,
    step: 0.04,
    unit: '',
    hint: '以清漆木面为等效坐标；不同地面按地面卡的 μ 缩放。',
  },
  {
    key: 'pieceFriction',
    label: '接触面摩擦 μ',
    min: 0.2,
    max: 0.85,
    step: 0.05,
    unit: '',
    hint: '骨牌底边、侧边与牌面的等效摩擦；顺序只能看到它和地面摩擦的联合效果。',
  },
  {
    key: 'reachMargin',
    label: '触发距离修正',
    min: -0.12,
    max: 0.48,
    step: 0.04,
    unit: 'm',
    hint: '加在高度导出的接触半径上；正值表示更早/更远触发。',
  },
  {
    key: 'faceLead',
    label: '双面提前量',
    min: -0.18,
    max: 0.18,
    step: 0.03,
    unit: 's',
    hint: 'A/B 两面的微小接触时差。没有双面观测时，整个先验区间都会保留。',
  },
]

function gridValues(min: number, max: number, step: number) {
  const count = Math.round((max - min) / step)
  return Array.from({ length: count + 1 }, (_, index) => {
    const value = min + index * step
    return Math.round(value * 1000) / 1000
  })
}

export function parameterGrid(): ParameterVector[] {
  const [ground, piece, reach, lead] = PARAM_SPECS
  const grounds = gridValues(ground.min, ground.max, ground.step)
  const pieces = gridValues(piece.min, piece.max, piece.step)
  const reaches = gridValues(reach.min, reach.max, reach.step)
  const leads = gridValues(lead.min, lead.max, lead.step)
  const result: ParameterVector[] = []
  for (const groundFriction of grounds) {
    for (const pieceFriction of pieces) {
      for (const reachMargin of reaches) {
        for (const faceLead of leads) {
          result.push({ groundFriction, pieceFriction, reachMargin, faceLead })
        }
      }
    }
  }
  return result
}

export function calibrationSignature(state: Pick<CalibrationState, 'samples' | 'holdoutId' | 'grounds'>) {
  const payload = JSON.stringify({
    samples: state.samples,
    holdoutId: state.holdoutId,
    grounds: state.grounds,
  })
  let hash = 2166136261
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `cal-${(hash >>> 0).toString(16)}-${payload.length}`
}

function pearson(xs: readonly number[], ys: readonly number[]) {
  const count = xs.length
  if (count < 2) return 0
  const meanX = xs.reduce((sum, value) => sum + value, 0) / count
  const meanY = ys.reduce((sum, value) => sum + value, 0) / count
  let numerator = 0
  let denominatorX = 0
  let denominatorY = 0
  for (let index = 0; index < count; index += 1) {
    const dx = xs[index] - meanX
    const dy = ys[index] - meanY
    numerator += dx * dy
    denominatorX += dx * dx
    denominatorY += dy * dy
  }
  if (!denominatorX || !denominatorY) return 0
  return Math.max(-1, Math.min(1, numerator / Math.sqrt(denominatorX * denominatorY)))
}

function emptyHoldout(state: CalibrationState): HoldoutVerdict {
  const holdout = state.samples.find(sample => sample.id === state.holdoutId && sample.role === 'holdout')
    ?? state.samples.find(sample => sample.role === 'holdout')
  return {
    sampleId: holdout?.id ?? 'missing-holdout',
    name: holdout?.name ?? '未设置保留分岔链',
    feasibleCount: 0,
    aCount: 0,
    bCount: 0,
    unresolvedCount: 0,
    completeCount: 0,
    aFraction: 0,
    bFraction: 0,
    unresolvedFraction: 1,
    opposite: false,
    consensus: false,
    majority: 'unresolved',
    aWitness: null,
    bWitness: null,
    observedOrderChecked: Boolean(holdout?.observedTiers.length),
    observedMatchCount: 0,
    observedMatchFraction: holdout?.observedTiers.length ? 0 : null,
  }
}

function buildRanges(feasible: readonly ParameterVector[]): ParameterRange[] {
  return PARAM_SPECS.map(spec => {
    const values = feasible.map(candidate => candidate[spec.key])
    const min = values.length ? Math.min(...values) : spec.min
    const max = values.length ? Math.max(...values) : spec.max
    const priorWidth = spec.max - spec.min
    const narrowing = values.length
      ? Math.max(0, Math.min(1, 1 - (max - min) / priorWidth))
      : 0
    const level = !values.length
      ? 'infeasible' as const
      : narrowing < 0.12 ? 'none' as const
        : narrowing < 0.62 ? 'weak' as const
          : 'joint' as const
    const dynamicHint = !values.length
      ? '当前样本没有留下任何可行组合。'
      : level === 'none'
        ? '可行上下界与先验几乎相同：该量没有被单独限制。'
        : level === 'weak'
          ? '只有边缘区间被排除；不能把这个范围当成唯一校准值。'
          : '区间明显收窄，但仍需检查与其他参数的相关性。'
    return {
      key: spec.key,
      label: spec.label,
      min,
      max,
      priorMin: spec.min,
      priorMax: spec.max,
      unit: spec.unit,
      step: spec.step,
      level,
      narrowing,
      hint: `${spec.hint} ${dynamicHint}`,
    }
  })
}

function buildGroundFrictionRanges(
  state: CalibrationState,
  feasible: readonly ParameterVector[],
): GroundFrictionRange[] {
  const groundSpec = PARAM_SPECS.find(spec => spec.key === 'groundFriction')!
  return state.grounds.map(ground => {
    const scale = ground.friction / REFERENCE_GROUND_FRICTION
    const values = feasible.map(candidate =>
      Math.max(0.05, Math.min(1.4, candidate.groundFriction * scale)))
    return {
      groundId: ground.id,
      name: ground.name,
      min: values.length ? Math.min(...values) : groundSpec.min * scale,
      max: values.length ? Math.max(...values) : groundSpec.max * scale,
      priorMin: groundSpec.min * scale,
      priorMax: groundSpec.max * scale,
    }
  })
}

function buildCorrelations(feasible: readonly ParameterVector[]): ParameterCorrelation[] {
  const pairs: [ParameterKey, ParameterKey][] = [
    ['groundFriction', 'reachMargin'],
    ['pieceFriction', 'reachMargin'],
    ['groundFriction', 'pieceFriction'],
    ['faceLead', 'reachMargin'],
  ]
  return pairs.map(([xKey, yKey]) => {
    const r = pearson(feasible.map(candidate => candidate[xKey]), feasible.map(candidate => candidate[yKey]))
    const xLabel = PARAM_SPECS.find(spec => spec.key === xKey)?.label ?? xKey
    const yLabel = PARAM_SPECS.find(spec => spec.key === yKey)?.label ?? yKey
    return {
      x: xKey,
      y: yKey,
      xLabel,
      yLabel,
      r,
      relation: (r <= -0.25 ? 'negative' : r >= 0.25 ? 'positive' : 'independent') as ParameterCorrelation['relation'],
    }
  }).sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
}

function buildJointConstraints(
  feasible: readonly ParameterVector[],
  grid: readonly ParameterVector[],
  oak: ReturnType<CalibrationState['grounds']['find']>,
): JointConstraint[] {
  const grips = (vectors: readonly ParameterVector[]) =>
    vectors.map(candidate => effectiveGrip(oak, candidate))
  const budgets = (vectors: readonly ParameterVector[]) =>
    vectors.map(candidate => contactBudget(candidate, effectiveGrip(oak, candidate)))

  const summarize = (
    key: string,
    label: string,
    values: readonly number[],
    priorValues: readonly number[],
    unit: JointConstraint['unit'],
    formula: string,
  ): JointConstraint => {
    const min = values.length ? Math.min(...values) : 0
    const max = values.length ? Math.max(...values) : 0
    const priorMin = Math.min(...priorValues)
    const priorMax = Math.max(...priorValues)
    const narrowing = values.length
      ? Math.max(0, Math.min(1, 1 - (max - min) / (priorMax - priorMin || 1)))
      : 0
    return { key, label, min, max, priorMin, priorMax, unit, formula, narrowing }
  }

  return [
    summarize(
      'contactBudget',
      '参考件接触预算 B',
      budgets(feasible),
      budgets(grid),
      'm',
      'B = Δr + 1.6 × (0.34g − 0.16θ₀), θ₀=0.8',
    ),
    summarize(
      'effectiveGrip',
      '有效握持 g',
      grips(feasible),
      grips(grid),
      '',
      'g = (μ_地面(eff) + μ_牌面) / 2',
    ),
  ]
}

function selectRepresentative(feasible: readonly ParameterVector[]): ParameterVector {
  if (!feasible.length) {
    return { groundFriction: 0.48, pieceFriction: 0.55, reachMargin: 0.12, faceLead: 0 }
  }
  const keys: ParameterKey[] = ['groundFriction', 'pieceFriction', 'reachMargin', 'faceLead']
  const means = Object.fromEntries(keys.map(key => [
    key,
    feasible.reduce((sum, candidate) => sum + candidate[key], 0) / feasible.length,
  ])) as ParameterVector
  const scales = Object.fromEntries(PARAM_SPECS.map(spec => [spec.key, spec.max - spec.min])) as Record<ParameterKey, number>
  let best = feasible[0]
  let bestDistance = Infinity
  for (const candidate of feasible) {
    const distance = keys.reduce((sum, key) => {
      const delta = (candidate[key] - means[key]) / (scales[key] || 1)
      return sum + delta * delta
    }, 0)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return { ...best }
}

function evaluateHoldout(
  state: CalibrationState,
  feasible: readonly ParameterVector[],
): HoldoutVerdict {
  const base = emptyHoldout(state)
  const holdout = state.samples.find(sample => sample.id === state.holdoutId && sample.role === 'holdout')
    ?? state.samples.find(sample => sample.role === 'holdout')
  if (!holdout || !feasible.length) return base

  const ground = state.grounds.find(item => item.id === holdout.groundId)
  let aCount = 0
  let bCount = 0
  let unresolvedCount = 0
  let completeCount = 0
  let observedMatchCount = 0
  let aWitness: ParameterVector | null = null
  let bWitness: ParameterVector | null = null
  const checkObserved = holdout.observedTiers.length > 0

  for (const candidate of feasible) {
    const prediction = predictSample(holdout, ground, candidate)
    if (prediction.winner === 'A') {
      aCount += 1
      aWitness ??= { ...candidate }
    } else if (prediction.winner === 'B') {
      bCount += 1
      bWitness ??= { ...candidate }
    } else {
      unresolvedCount += 1
    }
    if (prediction.complete) completeCount += 1
    if (checkObserved && orderMatches(prediction.order, holdout.observedTiers)) observedMatchCount += 1
  }

  const total = feasible.length
  const aFraction = aCount / total
  const bFraction = bCount / total
  const unresolvedFraction = unresolvedCount / total
  const opposite = aCount > 0 && bCount > 0
  const consensus = total > 0 && unresolvedCount === 0 && Math.max(aFraction, bFraction) >= 0.9
  const majority: HoldoutVerdict['majority'] = aCount === bCount
    ? 'split'
    : aCount > bCount ? 'A' : 'B'

  return {
    ...base,
    sampleId: holdout.id,
    name: holdout.name,
    feasibleCount: total,
    aCount,
    bCount,
    unresolvedCount,
    completeCount,
    aFraction,
    bFraction,
    unresolvedFraction,
    opposite,
    consensus,
    majority,
    aWitness,
    bWitness,
    observedOrderChecked: checkObserved,
    observedMatchCount,
    observedMatchFraction: checkObserved ? observedMatchCount / total : null,
  }
}

export function fitCalibration(state: CalibrationState): CalibrationFit {
  const grid = parameterGrid()
  const calibrationSamples = state.samples.filter(sample => sample.role === 'calibration')
  const stats = new Map<string, SampleFitStat>()

  for (const sample of calibrationSamples) {
    stats.set(sample.id, {
      sampleId: sample.id,
      name: sample.name,
      role: sample.role,
      groundId: sample.groundId,
      matchCount: 0,
      gridSize: grid.length,
      matchFraction: 0,
      budgetMin: null,
      budgetMax: null,
      note: '',
    })
  }

  const feasible: ParameterVector[] = []
  const missingObservedOrder = calibrationSamples.some(sample => sample.observedTiers.length === 0)

  for (const candidate of grid) {
    let allMatch = calibrationSamples.length > 0 && !missingObservedOrder

    for (const sample of calibrationSamples) {
      const ground = state.grounds.find(item => item.id === sample.groundId)
      const prediction = predictSample(sample, ground, candidate)
      const matches = !missingObservedOrder && orderMatches(prediction.order, sample.observedTiers)
      const stat = stats.get(sample.id)!
      const grip = effectiveGrip(ground, candidate)
      const budget = contactBudget(candidate, grip)
      stat.budgetMin = stat.budgetMin === null ? budget : Math.min(stat.budgetMin, budget)
      stat.budgetMax = stat.budgetMax === null ? budget : Math.max(stat.budgetMax, budget)
      if (matches) {
        stat.matchCount += 1
      } else {
        allMatch = false
      }
    }

    if (allMatch) feasible.push(candidate)
  }

  const sampleStats = calibrationSamples.map(sample => {
    const stat = stats.get(sample.id)!
    stat.matchFraction = stat.matchCount / Math.max(1, grid.length)
    if (missingObservedOrder && sample.observedTiers.length === 0) {
      stat.note = '缺少真实倒下顺序，未参与拟合。'
    } else if (stat.matchCount === 0) {
      stat.note = '没有参数组合能复现该顺序；检查坐标、门槛或顺序录入。'
    } else if (stat.matchFraction > 0.9) {
      stat.note = '几乎不筛选参数：主要确认方向，不提供独立区间。'
    } else if (stat.matchFraction < 0.25) {
      stat.note = '强约束样本：只有很窄的参数脊线能复现。'
    } else {
      stat.note = '排除了一部分组合，通常约束的是联合接触预算。'
    }
    return stat
  })

  const ranges = buildRanges(feasible)
  const groundFrictionRanges = buildGroundFrictionRanges(state, feasible)
  const correlations = buildCorrelations(feasible)
  const oak = state.grounds.find(ground => ground.id === 'oak')
  const jointConstraints = buildJointConstraints(feasible, grid, oak)
  const holdout = evaluateHoldout(state, feasible)
  const representatives = feasible
    .filter((_, index) => index % Math.max(1, Math.ceil(feasible.length / 12)) === 0)
    .slice(0, 12)

  let warning: string
  if (!calibrationSamples.length || missingObservedOrder) {
    warning = '至少需要一条已填写真实倒下顺序的校准样本；当前不能给出校准范围。'
  } else if (!feasible.length) {
    warning = '没有任何网格参数能同时复现校准样本。请检查实测顺序、起倒门槛或摆放尺寸，不能给出校准结论。'
  } else if (holdout.opposite) {
    warning = `仍有 ${feasible.length.toLocaleString()} 组可行参数；保留分岔链出现 A/B 相反预测。直线顺序没有唯一识别摩擦与触发距离，不能宣称已校准。`
  } else if (!holdout.consensus) {
    warning = `仍有 ${feasible.length.toLocaleString()} 组可行参数；保留链存在未决接触。请把范围用于预测集成，而不是只展示一组拟合值。`
  } else {
    warning = `保留链在 ${feasible.length.toLocaleString()} 组可行参数中预测一致；原始参数仍可能相关，应同时展示区间与联合约束。`
  }

  return {
    schemaVersion: 1,
    fitId: `fit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    fittedAt: Date.now(),
    signature: calibrationSignature(state),
    gridSize: grid.length,
    feasibleCount: feasible.length,
    ranges,
    groundFrictionRanges,
    jointConstraints,
    correlations,
    sampleStats,
    holdout,
    representatives,
    selectedCandidate: selectRepresentative(feasible),
    warning,
  }
}

export function buildRunSnapshot(fit: CalibrationFit, state: CalibrationState): CalibrationRunSnapshot {
  return {
    schemaVersion: 1,
    fitId: fit.fitId,
    fittedAt: fit.fittedAt,
    signature: fit.signature,
    calibrationSamples: state.samples
      .filter(sample => sample.role === 'calibration')
      .map(sample => ({ id: sample.id, name: sample.name })),
    holdout: { id: fit.holdout.sampleId, name: fit.holdout.name },
    feasibleCount: fit.feasibleCount,
    gridSize: fit.gridSize,
    selectedCandidate: { ...fit.selectedCandidate },
    ranges: fit.ranges.map(range => ({ ...range })),
    jointConstraints: fit.jointConstraints.map(constraint => ({ ...constraint })),
    correlations: fit.correlations.map(pair => ({ ...pair })),
    holdoutSummary: {
      aFraction: fit.holdout.aFraction,
      bFraction: fit.holdout.bFraction,
      unresolvedFraction: fit.holdout.unresolvedFraction,
      opposite: fit.holdout.opposite,
      consensus: fit.holdout.consensus,
      majority: fit.holdout.majority,
    },
    warning: fit.warning,
  }
}

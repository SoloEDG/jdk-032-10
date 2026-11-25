import { computed, ref, shallowRef, type Ref } from 'vue'
import type { DominoDocument } from '@/shared/document'
import {
  createDefaultCalibrationState,
  type CalibrationDimensions,
  type CalibrationSample,
  type CalibrationState,
} from '@/shared/calibration'
import { buildRunSnapshot, calibrationSignature, fitCalibration } from '../lib/fit'
import type { CalibrationRunSnapshot } from '@/shared/calibration'

type CommonPatch = Partial<CalibrationDimensions> & { fallThreshold?: number }

export function useCalibration(document: Ref<DominoDocument>, changed: () => void) {
  const fit = shallowRef<ReturnType<typeof fitCalibration> | null>(null)
  const fitting = ref(false)
  const selectedSampleId = ref<string | null>(
    document.value.calibration?.selectedSampleId
      ?? document.value.calibration?.samples[0]?.id
      ?? null,
  )

  const state = computed<CalibrationState>(() =>
    document.value.calibration ?? createDefaultCalibrationState())

  const selectedSample = computed(() =>
    state.value.samples.find(sample => sample.id === selectedSampleId.value)
      ?? state.value.samples.find(sample => sample.id === state.value.selectedSampleId)
      ?? state.value.samples[0]
      ?? null)

  const dirty = computed(() =>
    !fit.value || fit.value.signature !== calibrationSignature(state.value))

  const runSnapshot = computed<CalibrationRunSnapshot | null>(() => {
    if (!fit.value || dirty.value) return null
    return buildRunSnapshot(fit.value, state.value)
  })

  function mutate(mutator: (draft: CalibrationState) => void) {
    const draft: CalibrationState = structuredClone(state.value)
    mutator(draft)
    draft.selectedSampleId = selectedSampleId.value
    document.value = { ...document.value, calibration: draft }
    changed()
  }

  function selectSample(id: string) {
    selectedSampleId.value = id
  }

  function updateSample(id: string, patch: Partial<Omit<CalibrationSample, 'id' | 'nodes'>>) {
    mutate(draft => {
      const sample = draft.samples.find(item => item.id === id)
      if (sample) Object.assign(sample, patch)
    })
  }

  function updateCommon(id: string, patch: CommonPatch) {
    mutate(draft => {
      const sample = draft.samples.find(item => item.id === id)
      if (!sample) return
      const { fallThreshold, ...dimensions } = patch
      Object.assign(sample.dimensions, dimensions)
      if (typeof fallThreshold === 'number') {
        sample.fallThreshold = fallThreshold
        sample.nodes = sample.nodes.map(node => ({ ...node, fallThreshold }))
      }
      if (typeof dimensions.pieceHeight === 'number') {
        sample.nodes = sample.nodes.map(node => ({ ...node, height: dimensions.pieceHeight! }))
      }
      if (typeof dimensions.pieceWidth === 'number') {
        sample.nodes = sample.nodes.map(node => ({ ...node, width: dimensions.pieceWidth! }))
      }
    })
  }

  function updateNode(id: string, nodeId: string, patch: Partial<CalibrationSample['nodes'][number]>) {
    mutate(draft => {
      const sample = draft.samples.find(item => item.id === id)
      const node = sample?.nodes.find(item => item.id === nodeId)
      if (sample && node) Object.assign(node, patch)
    })
  }

  function updateOrder(id: string, tiers: CalibrationSample['observedTiers']) {
    mutate(draft => {
      const sample = draft.samples.find(item => item.id === id)
      if (!sample) return
      sample.observedTiers = tiers
      sample.status = tiers.length ? 'observed' : 'pending'
    })
  }

  function addSample() {
    const id = `sample-${crypto.randomUUID().slice(0, 8)}`
    const ids = ['n1', 'n2', 'n3', 'n4', 'n5']
    const sample: CalibrationSample = {
      id,
      name: `新试验链 ${state.value.samples.filter(item => item.role === 'calibration').length + 1}`,
      role: 'calibration',
      groundId: state.value.grounds[0]?.id ?? 'oak',
      startId: ids[0],
      dimensions: { spacing: 1.55, pieceHeight: 1.6, pieceWidth: 0.42, tolerance: 0.03 },
      fallThreshold: 0.8,
      nodes: ids.map((nodeId, index) => ({
        id: nodeId,
        label: nodeId.toUpperCase(),
        kind: 'domino',
        x: Math.round((1 + index * 1.55) * 100) / 100,
        y: 4,
        angle: 0,
        height: 1.6,
        width: 0.42,
        fallThreshold: 0.8,
      })),
      observedTiers: [],
      status: 'pending',
      note: '请填写实测先后，例如 n1 > n2 > n3。',
    }
    mutate(draft => draft.samples.push(sample))
    selectedSampleId.value = id
  }

  function importFromWorkspace() {
    const doc = document.value
    const id = `sample-${crypto.randomUUID().slice(0, 8)}`
    const nodes = doc.pieces.map(piece => ({
      id: piece.id,
      label: piece.label || piece.id,
      kind: piece.kind,
      x: piece.x,
      y: piece.y,
      angle: piece.angle,
      height: piece.height,
      width: piece.width,
      fallThreshold: piece.fallThreshold,
    }))

    const spacings: number[] = []
    for (const piece of doc.pieces) {
      let nearest = Infinity
      for (const other of doc.pieces) {
        if (other.id === piece.id) continue
        nearest = Math.min(nearest, Math.hypot(piece.x - other.x, piece.y - other.y))
      }
      if (Number.isFinite(nearest)) spacings.push(nearest)
    }
    const averageSpacing = spacings.length
      ? Math.round(spacings.reduce((sum, value) => sum + value, 0) / spacings.length * 100) / 100
      : 1.55
    const firstDomino = doc.pieces.find(piece => piece.kind === 'domino') ?? doc.pieces[0]

    const sample: CalibrationSample = {
      id,
      name: `工作台导入 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
      role: 'calibration',
      groundId: doc.scene.groundId ?? 'oak',
      startId: doc.startPieceId || firstDomino?.id || nodes[0]?.id || '',
      dimensions: {
        spacing: averageSpacing,
        pieceHeight: firstDomino?.height ?? 1.6,
        pieceWidth: firstDomino?.width ?? 0.42,
        tolerance: 0.03,
      },
      fallThreshold: firstDomino?.fallThreshold ?? 0.8,
      nodes,
      observedTiers: [],
      status: 'pending',
      note: '已快照工作台坐标、尺寸、门槛与地面；请补填真实观察顺序。',
    }
    mutate(draft => draft.samples.push(sample))
    selectedSampleId.value = id
    return id
  }

  function duplicateSample(id: string) {
    const source = state.value.samples.find(sample => sample.id === id)
    if (!source) return
    const newId = `sample-${crypto.randomUUID().slice(0, 8)}`
    const copy: CalibrationSample = {
      ...structuredClone(source),
      id: newId,
      name: `${source.name} 副本`,
      role: 'calibration',
      builtIn: false,
    }
    mutate(draft => draft.samples.push(copy))
    selectedSampleId.value = newId
  }

  function removeSample(id: string) {
    mutate(draft => {
      draft.samples = draft.samples.filter(sample => sample.id !== id)
      if (draft.holdoutId === id) {
        draft.holdoutId = draft.samples.find(sample => sample.role === 'holdout')?.id ?? ''
      }
    })
    if (selectedSampleId.value === id) selectedSampleId.value = state.value.samples[0]?.id ?? null
  }

  function setHoldout(id: string) {
    mutate(draft => {
      draft.holdoutId = id
      draft.samples = draft.samples.map(sample => ({
        ...sample,
        role: sample.id === id ? 'holdout' : 'calibration',
      }))
    })
  }

  function resetDefaults() {
    const confirmed = window.confirm('恢复内置样本会替换当前校准样本与保留链；工作台布局不受影响。是否继续？')
    if (!confirmed) return
    const defaults = createDefaultCalibrationState()
    document.value = { ...document.value, calibration: defaults }
    changed()
    selectedSampleId.value = defaults.selectedSampleId
  }

  let refitPromise: Promise<void> | null = null

  function refit(): Promise<void> {
    if (refitPromise) return refitPromise
    fitting.value = true
    refitPromise = (async () => {
      // Let the busy state paint before the synchronous ensemble search.
      await new Promise<void>(resolve => window.setTimeout(resolve, 24))
      try {
        fit.value = fitCalibration(state.value)
      } finally {
        fitting.value = false
      }
    })().finally(() => {
      refitPromise = null
    })
    return refitPromise
  }

  async function refitIfDirty() {
    if (refitPromise) await refitPromise
    else if (dirty.value || !fit.value) await refit()
  }

  return {
    state,
    selectedSample,
    selectedSampleId,
    fit,
    fitting,
    dirty,
    runSnapshot,
    selectSample,
    updateSample,
    updateCommon,
    updateNode,
    updateOrder,
    addSample,
    importFromWorkspace,
    duplicateSample,
    removeSample,
    setHoldout,
    resetDefaults,
    refit,
    refitIfDirty,
  }
}

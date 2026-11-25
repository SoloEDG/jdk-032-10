<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  FlaskConical,
  GitBranch,
  Import,
  Plus,
  RefreshCw,
  ShieldQuestion,
  Trash2,
} from '@lucide/vue'
import type {
  CalibrationDimensions,
  CalibrationFit,
  CalibrationNode,
  CalibrationRunSnapshot,
  CalibrationSample,
  CalibrationState,
  ParameterRange,
} from '@/shared/calibration'
import { orderToText, parseOrderText } from '../lib/predict'

const props = defineProps<{
  state: CalibrationState
  selectedSample: CalibrationSample | null
  fit: CalibrationFit | null
  fitting: boolean
  dirty: boolean
  snapshot: CalibrationRunSnapshot | null
}>()

const emit = defineEmits<{
  select: [string]
  refit: []
  'add-sample': []
  import: []
  reset: []
  'update-sample': [string, Partial<CalibrationSample>]
  'update-common': [string, Partial<CalibrationDimensions> & { fallThreshold?: number }]
  'update-node': [string, string, Partial<CalibrationNode>]
  'update-order': [string, string[][]]
  duplicate: [string]
  remove: [string]
  'set-holdout': [string]
  run: []
}>()

const orderDraft = ref('')
const orderError = ref('')

watch(
  () => [props.selectedSample?.id, props.selectedSample?.observedTiers] as const,
  () => {
    orderDraft.value = props.selectedSample ? orderToText(props.selectedSample.observedTiers) : ''
    orderError.value = ''
  },
  { immediate: true, deep: true },
)

const holdoutSample = computed(() =>
  props.state.samples.find(sample => sample.id === props.state.holdoutId)
    ?? props.state.samples.find(sample => sample.role === 'holdout')
    ?? null)

const footprint = computed(() => {
  const sample = props.selectedSample
  if (!sample || !sample.nodes.length) return '—'
  const xs = sample.nodes.map(node => node.x)
  const ys = sample.nodes.map(node => node.y)
  return `${(Math.max(...xs) - Math.min(...xs)).toFixed(1)} × ${(Math.max(...ys) - Math.min(...ys)).toFixed(1)} m`
})

function numberValue(event: Event) {
  return Number((event.target as HTMLInputElement).value)
}

function textValue(event: Event) {
  return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value
}

function groundName(id: string) {
  const ground = props.state.grounds.find(item => item.id === id)
  return ground ? `${ground.name} · μ${ground.friction.toFixed(2)}` : '未知地面'
}

function commitOrder() {
  const sample = props.selectedSample
  if (!sample) return
  const text = orderDraft.value.trim()
  if (!text) {
    orderError.value = ''
    emit('update-order', sample.id, [])
    return
  }
  const tiers = parseOrderText(text)
  const known = new Set(sample.nodes.map(node => node.id))
  const used = tiers.flat()
  const invalid = used.filter(id => !known.has(id))
  const duplicate = used.filter((id, index) => used.indexOf(id) !== index)
  if (invalid.length || duplicate.length) {
    orderError.value = invalid.length
      ? `找不到元件 ID：${[...new Set(invalid)].join(', ')}`
      : `ID 重复：${[...new Set(duplicate)].join(', ')}`
    return
  }
  orderError.value = ''
  emit('update-order', sample.id, tiers)
}

function formatParameter(value: number, unit: ParameterRange['unit']) {
  if (unit === 'm') return `${value >= 0 ? '+' : ''}${value.toFixed(2)} m`
  if (unit === 's') return `${Math.round(value * 1000)} ms`
  return value.toFixed(2)
}

function rangeStyle(range: { min: number; max: number; priorMin: number; priorMax: number }) {
  const span = range.priorMax - range.priorMin || 1
  const left = Math.max(0, Math.min(100, (range.min - range.priorMin) / span * 100))
  const width = Math.max(1.5, Math.min(100 - left, (range.max - range.min) / span * 100))
  return { left: `${left}%`, width: `${width}%` }
}

function fractionWidth(value: number) {
  return `${Math.max(0, Math.min(100, value * 100))}%`
}

function levelLabel(range: ParameterRange) {
  if (range.level === 'infeasible') return '无可行组合'
  if (range.level === 'none') return '未单独限制'
  if (range.level === 'weak') return '弱限制 / 仍相关'
  return '明显收窄'
}

function correlationLabel(r: number) {
  if (r <= -0.25) return `反向补偿 r=${r.toFixed(2)}`
  if (r >= 0.25) return `同向变化 r=${r.toFixed(2)}`
  return `近似独立 r=${r.toFixed(2)}`
}

function commonNumber(key: keyof CalibrationDimensions) {
  return props.selectedSample?.dimensions[key] ?? 0
}
</script>

<template>
  <section class="calibration-lab" aria-labelledby="calibration-title">
    <header class="cal-header">
      <div class="cal-title-wrap">
        <span class="cal-kicker"><FlaskConical :size="13" /> 06 / ORDER-ONLY IDENTIFIABILITY</span>
        <h2 id="calibration-title">校准实验室<span>不挑单一拟合值，保留全部可行参数范围</span></h2>
      </div>
      <div class="cal-header-actions">
        <span :class="['fit-status', { dirty, ready: fit && !dirty, busy: fitting }]">
          <RefreshCw v-if="fitting" :size="13" class="spin" />
          {{ fitting ? '正在网格拟合…' : dirty ? '样本已修改 · 待重新拟合' : fit ? `拟合 ${new Date(fit.fittedAt).toLocaleTimeString('zh-CN')}` : '尚未拟合' }}
        </span>
        <button class="cal-secondary" @click="emit('import')"><Import :size="14" /> 导入工作台</button>
        <button class="cal-secondary" @click="emit('add-sample')"><Plus :size="14" /> 新样本</button>
        <button class="cal-primary" :disabled="fitting" @click="emit('refit')">
          <RefreshCw :size="14" :class="{ spin: fitting }" /> 重新拟合
        </button>
      </div>
    </header>

    <div class="cal-grid">
      <section class="cal-card sample-card">
        <div class="card-heading">
          <h3>试验链样本</h3>
          <button class="text-button" @click="emit('reset')">恢复内置样本</button>
        </div>

        <div class="sample-list">
          <button
            v-for="sample in state.samples"
            :key="sample.id"
            :class="['sample-chip', { active: selectedSample?.id === sample.id, holdout: sample.role === 'holdout' }]"
            @click="emit('select', sample.id)"
          >
            <span class="sample-chip-main">
              <strong>{{ sample.name }}</strong>
              <small>{{ sample.nodes.length }} 件 · {{ groundName(sample.groundId).split(' · ')[0] }}</small>
            </span>
            <span :class="['role-badge', sample.role]">{{ sample.role === 'holdout' ? '保留检验' : '参与校准' }}</span>
          </button>
        </div>

        <template v-if="selectedSample">
          <div class="editor-head">
            <input class="name-input" :value="selectedSample.name" maxlength="34"
              @change="emit('update-sample', selectedSample.id, { name: textValue($event) })" />
            <button class="icon-button" title="复制样本" @click="emit('duplicate', selectedSample.id)"><Copy :size="14" /></button>
            <button class="icon-button danger" title="删除样本" @click="emit('remove', selectedSample.id)"><Trash2 :size="14" /></button>
          </div>

          <div class="editor-meta">
            <label class="field-label"><span>使用地面</span>
              <select :value="selectedSample.groundId" @change="emit('update-sample', selectedSample.id, { groundId: textValue($event) })">
                <option v-for="ground in state.grounds" :key="ground.id" :value="ground.id">
                  {{ ground.name }} · μ{{ ground.friction.toFixed(2) }}<template v-if="ground.slope"> · {{ ground.slope }}°</template>
                </option>
              </select>
            </label>
            <label class="field-label"><span>起倒起点 ID</span>
              <select :value="selectedSample.startId" @change="emit('update-sample', selectedSample.id, { startId: textValue($event) })">
                <option v-for="node in selectedSample.nodes" :key="node.id" :value="node.id">{{ node.id }} · {{ node.label }}</option>
              </select>
            </label>
          </div>

          <div class="dimension-grid">
            <label class="field-label"><span>标称间距 m</span>
              <input type="number" step="0.05" min="0.4" :value="commonNumber('spacing')"
                @change="emit('update-common', selectedSample.id, { spacing: numberValue($event) })" />
            </label>
            <label class="field-label"><span>牌高 m</span>
              <input type="number" step="0.05" min="0.4" :value="commonNumber('pieceHeight')"
                @change="emit('update-common', selectedSample.id, { pieceHeight: numberValue($event) })" />
            </label>
            <label class="field-label"><span>牌宽 m</span>
              <input type="number" step="0.02" min="0.1" :value="commonNumber('pieceWidth')"
                @change="emit('update-common', selectedSample.id, { pieceWidth: numberValue($event) })" />
            </label>
            <label class="field-label"><span>摆放误差 m</span>
              <input type="number" step="0.005" min="0" :value="commonNumber('tolerance')"
                @change="emit('update-common', selectedSample.id, { tolerance: numberValue($event) })" />
            </label>
            <label class="field-label threshold-field"><span>起倒门槛 θ</span>
              <input type="number" step="0.05" min="0.2" max="1.8" :value="selectedSample.fallThreshold"
                @change="emit('update-common', selectedSample.id, { fallThreshold: numberValue($event) })" />
            </label>
            <div class="footprint"><span>实测坐标包络</span><strong>{{ footprint }}</strong></div>
          </div>

          <div class="node-table-wrap">
            <div class="node-table">
              <div class="node-row node-head">
                <span>ID</span><span>X</span><span>Y</span><span>高</span><span>宽</span><span>θ</span><span>角</span><span>面</span>
              </div>
              <div v-for="node in selectedSample.nodes" :key="node.id" class="node-row">
                <span class="node-id" :title="node.label">{{ node.id }}</span>
                <input type="number" step="0.05" :value="node.x" @change="emit('update-node', selectedSample.id, node.id, { x: numberValue($event) })" />
                <input type="number" step="0.05" :value="node.y" @change="emit('update-node', selectedSample.id, node.id, { y: numberValue($event) })" />
                <input type="number" step="0.05" :value="node.height" @change="emit('update-node', selectedSample.id, node.id, { height: numberValue($event) })" />
                <input type="number" step="0.02" :value="node.width" @change="emit('update-node', selectedSample.id, node.id, { width: numberValue($event) })" />
                <input type="number" step="0.05" :value="node.fallThreshold" @change="emit('update-node', selectedSample.id, node.id, { fallThreshold: numberValue($event) })" />
                <input type="number" step="1" :value="node.angle" @change="emit('update-node', selectedSample.id, node.id, { angle: numberValue($event) })" />
                <select :value="node.contactFace ?? ''" aria-label="接触面"
                  @change="emit('update-node', selectedSample.id, node.id, { contactFace: (textValue($event) || undefined) as CalibrationNode['contactFace'] })">
                  <option value="">—</option>
                  <option value="A">A</option>
                  <option value="B">B</option>
                </select>
              </div>
            </div>
          </div>

          <label class="field-label order-field">
            <span>真实倒下顺序（用 &gt; 分先后，= 表示同帧；逗号也可）</span>
            <textarea rows="2" :value="orderDraft" placeholder="n1 > n2 > n3"
              @input="orderDraft = textValue($event)" @change="commitOrder" @blur="commitOrder"></textarea>
          </label>
          <p v-if="orderError" class="order-error"><AlertTriangle :size="12" /> {{ orderError }}</p>
          <p v-else class="sample-note">{{ selectedSample.note || '记录尺寸、门槛、地面与可见顺序；顺序只用于约束参数集合。' }}</p>

          <button
            :class="['holdout-toggle', { active: state.holdoutId === selectedSample.id }]"
            @click="emit('set-holdout', selectedSample.id)"
          >
            <GitBranch :size="14" />
            {{ state.holdoutId === selectedSample.id ? '当前唯一保留检验链（不参与拟合）' : '设为唯一保留检验链' }}
          </button>
        </template>
      </section>

      <section class="cal-card identifiability-card">
        <div class="card-heading"><h3>哪些量真的被限制</h3><ShieldQuestion :size="16" /></div>

        <div v-if="!fit" class="cal-empty">
          <RefreshCw v-if="fitting" :size="22" class="spin" />
          <p>{{ fitting ? '正在枚举参数网格并比对顺序…' : '点击“重新拟合”查看可行参数范围。' }}</p>
        </div>

        <template v-else>
          <div :class="['fit-warning', fit.feasibleCount ? (fit.holdout.opposite ? 'warn' : 'ok') : 'danger']">
            <AlertTriangle v-if="fit.holdout.opposite || !fit.feasibleCount" :size="15" />
            <CheckCircle2 v-else :size="15" />
            <p>{{ fit.warning }}</p>
          </div>

          <div class="ensemble-stats">
            <div><span>网格组合</span><strong class="mono">{{ fit.gridSize.toLocaleString() }}</strong></div>
            <div><span>全部样本拟合</span><strong class="mono">{{ fit.feasibleCount.toLocaleString() }}</strong></div>
            <div><span>存活率</span><strong class="mono">{{ fractionWidth(fit.feasibleCount / fit.gridSize) }}</strong></div>
          </div>

          <div class="range-list">
            <div v-for="range in fit.ranges" :key="range.key" class="range-row">
              <div class="range-label">
                <span>{{ range.label }}</span>
                <em :data-level="range.level">{{ levelLabel(range) }}</em>
              </div>
              <div class="range-track">
                <div class="range-prior"></div>
                <div class="range-feasible" :style="rangeStyle(range)"></div>
              </div>
              <div class="range-values mono">
                <span>{{ formatParameter(range.min, range.unit) }}</span>
                <small>/ 先验 {{ formatParameter(range.priorMin, range.unit) }}–{{ formatParameter(range.priorMax, range.unit) }}</small>
                <span>{{ formatParameter(range.max, range.unit) }}</span>
              </div>
              <p>{{ range.hint }}</p>
            </div>
          </div>

          <div class="ground-mu-block">
            <h4>各地面的有效摩擦区间</h4>
            <div v-for="groundRange in fit.groundFrictionRanges" :key="groundRange.groundId" class="ground-mu-row">
              <span>{{ groundRange.name }}</span>
              <code class="mono">{{ groundRange.min.toFixed(2) }}–{{ groundRange.max.toFixed(2) }}</code>
            </div>
          </div>

          <div class="constraint-block">
            <h4>联合量与相关性</h4>
            <div v-for="constraint in fit.jointConstraints" :key="constraint.key" class="joint-row">
              <div class="range-label"><span>{{ constraint.label }}</span><em data-level="joint">收窄 {{ Math.round(constraint.narrowing * 100) }}%</em></div>
              <div class="range-track"><div class="range-prior"></div><div class="range-feasible joint" :style="rangeStyle(constraint)"></div></div>
              <div class="range-values mono"><span>{{ constraint.min.toFixed(2) }}{{ constraint.unit }}</span><span>{{ constraint.max.toFixed(2) }}{{ constraint.unit }}</span></div>
              <code>{{ constraint.formula }}</code>
            </div>
            <div class="correlation-list">
              <span v-for="pair in fit.correlations.slice(0, 3)" :key="`${pair.x}-${pair.y}`" :data-relation="pair.relation">
                {{ pair.xLabel.replace(' μ', '').replace('修正', '') }} × {{ pair.yLabel.replace(' μ', '').replace('修正', '') }}
                <strong>{{ correlationLabel(pair.r) }}</strong>
              </span>
            </div>
          </div>

          <div class="sample-contributions">
            <h4>单条样本的筛选强度</h4>
            <div v-for="stat in fit.sampleStats" :key="stat.sampleId" class="contribution-row">
              <div><strong>{{ stat.name }}</strong><span class="mono">{{ Math.round(stat.matchFraction * 100) }}% 组合可单独复现</span></div>
              <p>{{ stat.note }}</p>
            </div>
          </div>
        </template>
      </section>

      <section class="cal-card holdout-card">
        <div class="card-heading"><h3>未参与校准的分岔检验</h3><GitBranch :size="16" /></div>

        <template v-if="holdoutSample">
          <div class="holdout-name">
            <strong>{{ fit?.holdout.name ?? holdoutSample.name }}</strong>
            <span class="role-badge holdout">HOLDOUT</span>
          </div>
          <p class="holdout-ground">{{ groundName(holdoutSample.groundId) }} · {{ holdoutSample.nodes.length }} 件 · {{ holdoutSample.dimensions.spacing.toFixed(2) }} m 标称间距</p>

          <div v-if="!fit" class="cal-empty compact"><p>拟合后，这里会枚举所有可行参数对 A/B 两面的预测。</p></div>
          <template v-else>
            <div class="prediction-bar" role="img" :aria-label="`A 先接触 ${Math.round(fit.holdout.aFraction * 100)}%，B 先接触 ${Math.round(fit.holdout.bFraction * 100)}%`">
              <span class="pred-a" :style="fractionWidth(fit.holdout.aFraction)"></span>
              <span class="pred-b" :style="fractionWidth(fit.holdout.bFraction)"></span>
              <span class="pred-none" :style="fractionWidth(fit.holdout.unresolvedFraction)"></span>
            </div>
            <div class="prediction-legend">
              <span><i class="dot-a"></i>A 面先接触 <strong class="mono">{{ Math.round(fit.holdout.aFraction * 100) }}%</strong><small>{{ fit.holdout.aCount }} 组</small></span>
              <span><i class="dot-b"></i>B 面先接触 <strong class="mono">{{ Math.round(fit.holdout.bFraction * 100) }}%</strong><small>{{ fit.holdout.bCount }} 组</small></span>
              <span><i class="dot-none"></i>未决/中断 <strong class="mono">{{ Math.round(fit.holdout.unresolvedFraction * 100) }}%</strong><small>{{ fit.holdout.unresolvedCount }} 组</small></span>
            </div>

            <div :class="['verdict-box', fit.holdout.consensus ? 'consensus' : 'split']">
              <CheckCircle2 v-if="fit.holdout.consensus" :size="18" />
              <AlertTriangle v-else :size="18" />
              <div>
                <strong>{{ fit.holdout.consensus ? '集成预测一致' : '预测仍会相反' }}</strong>
                <p v-if="fit.holdout.opposite">同一份拟合区间内，A 先和 B 先的参数组合都存在。直线顺序无法消除这个分歧。</p>
                <p v-else-if="!fit.feasibleCount">没有可行参数可用于检验。</p>
                <p v-else>多数倾向 {{ fit.holdout.majority }}，但未达到 90% 一致性门槛；仍需保留区间。</p>
              </div>
            </div>

            <div v-if="fit.holdout.aWitness && fit.holdout.bWitness" class="witness-grid">
              <article class="witness a-witness">
                <strong>可行组合 → A 先接触</strong>
                <code>μ地 {{ fit.holdout.aWitness.groundFriction.toFixed(2) }} · μ牌 {{ fit.holdout.aWitness.pieceFriction.toFixed(2) }}</code>
                <code>Δr {{ fit.holdout.aWitness.reachMargin.toFixed(2) }}m · 面差 {{ Math.round(fit.holdout.aWitness.faceLead * 1000) }}ms</code>
              </article>
              <article class="witness b-witness">
                <strong>另一可行组合 → B 先接触</strong>
                <code>μ地 {{ fit.holdout.bWitness.groundFriction.toFixed(2) }} · μ牌 {{ fit.holdout.bWitness.pieceFriction.toFixed(2) }}</code>
                <code>Δr {{ fit.holdout.bWitness.reachMargin.toFixed(2) }}m · 面差 {{ Math.round(fit.holdout.bWitness.faceLead * 1000) }}ms</code>
              </article>
            </div>

            <div v-if="fit.holdout.observedOrderChecked" class="observed-check">
              <strong>实测顺序核对</strong>
              <p>{{ fit.holdout.observedMatchCount }} / {{ fit.feasibleCount }} 组可行参数复现保留链顺序（{{ Math.round((fit.holdout.observedMatchFraction ?? 0) * 100) }}%）。该结果没有参与拟合。</p>
            </div>
            <div v-else class="observed-check pending">
              <strong>等待你的独立实测</strong>
              <p>可在左侧样本顺序框补填保留链的真实先后；系统只会做事后核对，不会把它加入校准。</p>
            </div>

            <div class="snapshot-box">
              <div class="card-heading compact-heading"><h4>模拟快照</h4><span :class="['snapshot-pill', snapshot ? 'saved' : 'stale']">{{ snapshot ? '下一次运行附带' : dirty ? '待重新拟合' : '不可用' }}</span></div>
              <template v-if="snapshot">
                <p>将使用一个真实可行候选驱动动画，并把当时的完整范围写入运行回顾。</p>
                <div class="candidate-grid mono">
                  <span>μ地 {{ snapshot.selectedCandidate.groundFriction.toFixed(2) }}</span>
                  <span>μ牌 {{ snapshot.selectedCandidate.pieceFriction.toFixed(2) }}</span>
                  <span>Δr {{ snapshot.selectedCandidate.reachMargin.toFixed(2) }}m</span>
                  <span>面差 {{ Math.round(snapshot.selectedCandidate.faceLead * 1000) }}ms</span>
                </div>
                <button class="run-with-snapshot" @click="emit('run')"><FlaskConical :size="14" /> 用该集成候选运行模拟</button>
              </template>
              <p v-else>重新拟合后，新的模拟运行会冻结一份参数范围；旧运行中的快照不会被覆盖。</p>
            </div>
          </template>
        </template>
        <div v-else class="cal-empty"><p>请先创建一条分岔链，并将其设为保留检验。</p></div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.calibration-lab {
  grid-column: 1 / -1;
  margin-top: 4px;
  padding: 16px;
  border: 1px solid #3f5146;
  border-radius: 10px;
  background:
    radial-gradient(circle at 12% 0%, rgba(230, 189, 104, .08), transparent 30%),
    var(--panel);
  box-shadow: 0 18px 40px #0d191566;
}
.cal-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.cal-kicker { display: inline-flex; align-items: center; gap: 7px; color: var(--quiet); font: 9px var(--mono); letter-spacing: .12em; }
.cal-title-wrap h2 { display: flex; align-items: baseline; gap: 12px; margin-top: 7px; font-size: 20px; }
.cal-title-wrap h2 span { color: var(--muted); font-size: 11px; font-weight: 400; }
.cal-header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.fit-status { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 9px; border: 1px solid var(--rule-soft); border-radius: 999px; color: var(--quiet); font-size: 10px; }
.fit-status.ready { color: var(--mint); border-color: #49634f; background: #26372e; }
.fit-status.dirty { color: var(--gold); border-color: #6d6040; background: #383326; }
.fit-status.busy { color: var(--cream); }
.cal-primary, .cal-secondary { min-height: 34px; display: inline-flex; align-items: center; gap: 7px; padding: 0 11px; border-radius: 5px; font-size: 11px; }
.cal-primary { border: 1px solid #edc978; background: var(--gold); color: #1d2923; font-weight: 700; }
.cal-secondary { border: 1px solid var(--rule); background: #24342e; color: var(--muted); }
.cal-secondary:hover, .cal-primary:hover:not(:disabled) { border-color: var(--gold); }
.cal-grid { display: grid; grid-template-columns: minmax(430px, 1.15fr) minmax(360px, .95fr) minmax(330px, .9fr); gap: 14px; align-items: start; }
.cal-card { min-width: 0; padding: 14px; border: 1px solid var(--rule-soft); border-radius: 8px; background: rgba(26, 41, 37, .72); }
.card-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 11px; color: var(--gold); }
.card-heading h3 { color: var(--ink); font-size: 14px; }
.card-heading svg { color: var(--gold); }
.text-button { border: 0; background: transparent; color: var(--quiet); font-size: 10px; text-decoration: underline; text-underline-offset: 3px; }
.text-button:hover { color: var(--gold); }
.sample-list { display: grid; gap: 5px; margin-bottom: 13px; max-height: 178px; overflow: auto; padding-right: 2px; }
.sample-chip { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 9px; border: 1px solid var(--rule-soft); border-radius: 5px; background: #1d2d28; text-align: left; }
.sample-chip:hover { border-color: #5b6b58; }
.sample-chip.active { border-color: #8b8159; background: #343a2d; }
.sample-chip.holdout { border-left: 2px solid var(--terracotta); }
.sample-chip-main { min-width: 0; display: grid; gap: 3px; }
.sample-chip-main strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.sample-chip-main small { color: var(--quiet); font-size: 9px; }
.role-badge { flex: none; padding: 3px 6px; border-radius: 999px; border: 1px solid #4b5c50; color: var(--mint); font: 8px var(--mono); }
.role-badge.holdout { color: var(--terracotta); border-color: #765448; background: #3a2d27; }
.editor-head { display: flex; gap: 7px; margin-bottom: 10px; }
.name-input { flex: 1; min-width: 0; height: 34px; padding: 0 9px; border: 1px solid #3a4b42; border-radius: 4px; background: var(--field); color: var(--ink); font-size: 12px; font-weight: 600; }
.icon-button { width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid var(--rule); border-radius: 4px; background: transparent; color: var(--muted); }
.icon-button:hover { border-color: var(--gold); color: var(--ink); }
.icon-button.danger:hover { border-color: #a96552; color: var(--terracotta); }
.editor-meta, .dimension-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-bottom: 10px; }
.dimension-grid { grid-template-columns: repeat(3, 1fr); }
.dimension-grid .threshold-field { grid-column: span 1; }
.footprint { grid-column: span 2; display: flex; flex-direction: column; justify-content: end; gap: 4px; padding: 7px 8px; border: 1px dashed #43564c; border-radius: 4px; }
.footprint span { color: var(--quiet); font-size: 9px; }
.footprint strong { color: var(--gold); font: 11px var(--mono); }
.node-table-wrap { overflow: auto; border: 1px solid var(--rule-soft); border-radius: 5px; margin: 4px 0 10px; }
.node-table { min-width: 500px; }
.node-row { display: grid; grid-template-columns: 54px repeat(6, minmax(48px, 1fr)) 42px; gap: 4px; align-items: center; padding: 4px 6px; border-bottom: 1px solid #263831; }
.node-row:last-child { border-bottom: 0; }
.node-head { position: sticky; top: 0; background: #26372f; color: var(--quiet); font: 8px var(--mono); }
.node-id { overflow: hidden; text-overflow: ellipsis; color: var(--cream); font: 9px var(--mono); }
.node-row input, .node-row select { width: 100%; min-width: 0; height: 27px; padding: 0 4px; border: 1px solid #35473e; border-radius: 3px; background: #172620; color: var(--ink); font: 10px var(--mono); }
.order-field textarea { width: 100%; padding: 8px; border: 1px solid #3a4b42; border-radius: 4px; background: var(--field); color: var(--ink); font: 11px var(--mono); resize: vertical; }
.order-error { display: flex; align-items: center; gap: 5px; margin: 6px 0; color: var(--terracotta); font-size: 10px; }
.sample-note { margin: 7px 0 10px; color: var(--quiet); font-size: 10px; line-height: 1.55; }
.holdout-toggle { width: 100%; min-height: 34px; display: flex; align-items: center; justify-content: center; gap: 7px; border: 1px solid #765448; border-radius: 4px; background: #332a25; color: #efb298; font-size: 11px; }
.holdout-toggle.active { border-color: var(--terracotta); background: #493229; }
.fit-warning { display: flex; gap: 8px; padding: 10px; border-radius: 5px; margin-bottom: 11px; font-size: 10px; line-height: 1.5; }
.fit-warning svg { flex: none; margin-top: 1px; }
.fit-warning.warn { border: 1px solid #6f5d38; background: #3a3425; color: #f0d59a; }
.fit-warning.ok { border: 1px solid #46634e; background: #27382e; color: #b9ddc5; }
.fit-warning.danger { border: 1px solid #74483c; background: #3b2a26; color: #f0b39d; }
.fit-warning p { margin: 0; }
.ensemble-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin-bottom: 13px; }
.ensemble-stats div { padding: 8px; border: 1px solid var(--rule-soft); border-radius: 5px; background: #1c2c27; }
.ensemble-stats span { display: block; color: var(--quiet); font-size: 9px; }
.ensemble-stats strong { display: block; margin-top: 4px; color: var(--cream); font-size: 13px; }
.range-list { display: grid; gap: 11px; }
.range-label { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--ink); font-size: 11px; }
.range-label em { padding: 2px 5px; border-radius: 999px; font-style: normal; font-size: 8px; border: 1px solid #4c5d52; color: var(--muted); white-space: nowrap; }
.range-label em[data-level="weak"] { color: var(--gold); border-color: #6d6040; }
.range-label em[data-level="none"] { color: var(--terracotta); border-color: #765448; }
.range-label em[data-level="joint"] { color: var(--mint); border-color: #49634f; }
.range-label em[data-level="infeasible"] { color: #ff8f70; border-color: #8a4d3e; }
.range-track { position: relative; height: 7px; margin: 7px 0 4px; border-radius: 999px; background: #172620; overflow: hidden; }
.range-prior { position: absolute; inset: 0; background: repeating-linear-gradient(90deg, #33463d 0 5px, #2a3b34 5px 10px); }
.range-feasible { position: absolute; top: 0; bottom: 0; border-radius: 999px; background: linear-gradient(90deg, #c9974f, var(--gold)); box-shadow: 0 0 9px #e6bd6855; }
.range-feasible.joint { background: linear-gradient(90deg, #6ea985, var(--mint)); box-shadow: 0 0 9px #91c4a455; }
.range-values { display: flex; align-items: center; justify-content: space-between; gap: 6px; color: var(--gold); font-size: 9px; }
.range-values small { flex: 1; text-align: center; color: var(--quiet); font-size: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.range-row p { margin-top: 4px; color: var(--quiet); font-size: 9px; line-height: 1.45; }
.ground-mu-block { margin-top: 12px; padding: 9px; border: 1px solid var(--rule-soft); border-radius: 5px; background: #1c2c27; }
.ground-mu-block h4 { margin-bottom: 7px; color: var(--cream); font-size: 10px; }
.ground-mu-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 3px 0; color: var(--muted); font-size: 9px; }
.ground-mu-row code { color: var(--mint); font-size: 9px; }
.constraint-block, .sample-contributions { margin-top: 15px; padding-top: 12px; border-top: 1px solid var(--rule-soft); }
.constraint-block h4, .sample-contributions h4 { margin-bottom: 9px; color: var(--cream); font-size: 11px; }
.joint-row { margin-bottom: 11px; }
.joint-row code { display: block; margin-top: 5px; color: var(--quiet); font: 9px var(--mono); }
.correlation-list { display: grid; gap: 5px; margin-top: 8px; }
.correlation-list span { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 8px; border: 1px solid var(--rule-soft); border-radius: 4px; color: var(--muted); font-size: 9px; }
.correlation-list strong { font: 9px var(--mono); }
.correlation-list [data-relation="negative"] strong { color: var(--gold); }
.correlation-list [data-relation="positive"] strong { color: var(--mint); }
.correlation-list [data-relation="independent"] strong { color: var(--quiet); }
.contribution-row { padding: 7px 0; border-bottom: 1px solid #263831; }
.contribution-row:last-child { border-bottom: 0; }
.contribution-row > div { display: flex; justify-content: space-between; gap: 8px; }
.contribution-row strong { font-size: 10px; }
.contribution-row span { color: var(--gold); font-size: 8px; }
.contribution-row p { margin-top: 4px; color: var(--quiet); font-size: 9px; line-height: 1.45; }
.cal-empty { min-height: 120px; display: grid; place-content: center; justify-items: center; gap: 8px; color: var(--quiet); text-align: center; font-size: 11px; }
.cal-empty.compact { min-height: 74px; }
.holdout-name { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.holdout-name strong { font-size: 14px; }
.holdout-ground { margin: 7px 0 13px; color: var(--quiet); font-size: 10px; }
.prediction-bar { display: flex; width: 100%; height: 13px; overflow: hidden; border-radius: 999px; background: #1a2924; border: 1px solid #3a4b42; }
.prediction-bar span { display: block; height: 100%; }
.pred-a { background: var(--mint); }
.pred-b { background: var(--terracotta); }
.pred-none { background: #65736a; }
.prediction-legend { display: grid; gap: 7px; margin: 11px 0; }
.prediction-legend span { display: grid; grid-template-columns: 9px 1fr auto auto; align-items: center; gap: 7px; color: var(--muted); font-size: 10px; }
.prediction-legend strong { color: var(--ink); font-size: 11px; }
.prediction-legend small { color: var(--quiet); font-size: 8px; }
.prediction-legend i { width: 8px; height: 8px; border-radius: 50%; }
.dot-a { background: var(--mint); }.dot-b { background: var(--terracotta); }.dot-none { background: #65736a; }
.verdict-box { display: flex; gap: 9px; padding: 11px; border-radius: 6px; margin: 12px 0; }
.verdict-box.split { border: 1px solid #765448; background: #3a2b26; color: #f0b39d; }
.verdict-box.consensus { border: 1px solid #46634e; background: #27382e; color: #b9ddc5; }
.verdict-box strong { font-size: 12px; }
.verdict-box p { margin-top: 4px; color: var(--muted); font-size: 10px; line-height: 1.5; }
.witness-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin: -2px 0 12px; }
.witness { display: grid; gap: 5px; padding: 9px; border-radius: 5px; border: 1px solid var(--rule-soft); background: #1c2c27; }
.witness strong { font-size: 9px; line-height: 1.4; }
.witness code { color: var(--muted); font: 8px/1.45 var(--mono); }
.a-witness { border-left: 2px solid var(--mint); }
.a-witness strong { color: var(--mint); }
.b-witness { border-left: 2px solid var(--terracotta); }
.b-witness strong { color: var(--terracotta); }
.observed-check, .snapshot-box { padding: 10px; border: 1px solid var(--rule-soft); border-radius: 6px; background: #1c2c27; margin-top: 9px; }
.observed-check strong, .snapshot-box h4 { color: var(--cream); font-size: 11px; }
.observed-check p, .snapshot-box p { margin-top: 5px; color: var(--quiet); font-size: 9px; line-height: 1.5; }
.observed-check.pending { border-style: dashed; }
.compact-heading { margin-bottom: 4px; }
.snapshot-pill { padding: 3px 6px; border-radius: 999px; font: 8px var(--mono); }
.snapshot-pill.saved { color: var(--mint); background: #2b4034; }
.snapshot-pill.stale { color: var(--gold); background: #403827; }
.candidate-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin: 8px 0; color: var(--mint); font-size: 9px; }
.run-with-snapshot { width: 100%; min-height: 34px; display: flex; align-items: center; justify-content: center; gap: 7px; border: 1px solid #edc978; border-radius: 4px; background: var(--gold); color: #1d2923; font-size: 11px; font-weight: 700; }
.spin { animation: spin .8s linear infinite; }
@media (max-width: 1450px) { .cal-grid { grid-template-columns: 1fr 1fr; } .holdout-card { grid-column: 1 / -1; } }
@media (max-width: 900px) { .cal-grid { grid-template-columns: 1fr; } .holdout-card { grid-column: auto; } .cal-header { flex-direction: column; } .cal-header-actions { justify-content: flex-start; } .witness-grid { grid-template-columns: 1fr; } }
</style>

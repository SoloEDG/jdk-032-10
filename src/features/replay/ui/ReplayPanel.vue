<script setup lang="ts">
import { AlertTriangle, CheckCircle2, CircleStop, FastForward, Lock, Pause, Play, RotateCcw, SkipBack } from '@lucide/vue'
import type { SimulationEvent, SimulationRun } from '@/shared/document'
import type { ParameterRange } from '@/shared/calibration'
import { formatSeconds } from '@/shared/time'

defineProps<{
  run: SimulationRun | null; events: SimulationEvent[]; time: number; playing: boolean
  currentEvent: SimulationEvent | null; stale: boolean
}>()
const emit = defineEmits<{ toggle: []; seek: [number]; restart: []; event: [string] }>()
const iconFor = (kind: SimulationEvent['kind']) => kind === 'interrupted' ? AlertTriangle
  : kind === 'mechanism' ? FastForward : CheckCircle2

function formatRangeValue(value: number, unit: ParameterRange['unit']) {
  if (unit === 'm') return `${value.toFixed(2)}m`
  if (unit === 's') return `${Math.round(value * 1000)}ms`
  return value.toFixed(2)
}
function snapshotTime(value: number) {
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <section class="replay-panel" aria-labelledby="replay-title">
    <div class="replay-heading">
      <div class="section-kicker"><span>05 / REVIEW</span><h2 id="replay-title">结果回看</h2></div>
      <span v-if="run" class="replay-revision" :class="{ stale }">{{ stale ? '旧版布局' : `R${run.revision}` }}</span>
    </div>
    <template v-if="run">
      <div class="replay-summary" :class="run.status">
        <div class="summary-symbol"><CircleStop v-if="run.status === 'interrupted'" :size="17" /><CheckCircle2 v-else :size="17" /></div>
        <div><strong>{{ run.status === 'interrupted' ? '找到中断点' : run.status === 'complete' ? '连锁已完成' : '场景暂无元件' }}</strong>
          <small>{{ run.interruptionReason ?? '所有触发事件均已记录' }}</small></div>
      </div>

      <div v-if="run.calibrationSnapshot" class="run-cal-snapshot">
        <div class="run-cal-head">
          <Lock :size="13" />
          <strong>当时校准范围已冻结</strong>
          <span class="mono">{{ run.calibrationSnapshot.feasibleCount }}/{{ run.calibrationSnapshot.gridSize }}</span>
        </div>
        <p class="run-cal-warning" :class="{ split: run.calibrationSnapshot.holdoutSummary.opposite }">
          {{ run.calibrationSnapshot.warning }}
        </p>
        <div class="run-cal-ranges">
          <div v-for="range in run.calibrationSnapshot.ranges" :key="range.key">
            <span>{{ range.label }}</span>
            <code>{{ formatRangeValue(range.min, range.unit) }}–{{ formatRangeValue(range.max, range.unit) }}</code>
          </div>
        </div>
        <details>
          <summary>查看候选、相关性与分岔预测</summary>
          <div class="run-cal-candidate mono">
            动画候选：μ地 {{ run.calibrationSnapshot.selectedCandidate.groundFriction.toFixed(2) }}
            · μ牌 {{ run.calibrationSnapshot.selectedCandidate.pieceFriction.toFixed(2) }}
            · Δr {{ run.calibrationSnapshot.selectedCandidate.reachMargin.toFixed(2) }}m
            · 面差 {{ Math.round(run.calibrationSnapshot.selectedCandidate.faceLead * 1000) }}ms
          </div>
          <div class="run-cal-holdout">
            保留链 {{ run.calibrationSnapshot.holdout.name }}：
            A {{ Math.round(run.calibrationSnapshot.holdoutSummary.aFraction * 100) }}% /
            B {{ Math.round(run.calibrationSnapshot.holdoutSummary.bFraction * 100) }}% /
            未决 {{ Math.round(run.calibrationSnapshot.holdoutSummary.unresolvedFraction * 100) }}%
          </div>
          <ul>
            <li v-for="pair in run.calibrationSnapshot.correlations.slice(0, 3)" :key="`${pair.x}-${pair.y}`">
              {{ pair.xLabel }} × {{ pair.yLabel }}：r={{ pair.r.toFixed(2) }}
            </li>
          </ul>
        </details>
        <small>快照 {{ snapshotTime(run.calibrationSnapshot.fittedAt) }} · 修改样本并重新拟合不会改写本回顾</small>
      </div>
      <div v-else class="run-cal-missing">该回顾未携带校准范围快照。</div>

      <div class="replay-controls">
        <button class="replay-icon" aria-label="回到开头" @click="emit('restart')"><SkipBack :size="15" /></button>
        <button class="replay-play" :aria-label="playing ? '暂停回放' : '播放回放'" @click="emit('toggle')">
          <Pause v-if="playing" :size="16" fill="currentColor" /><Play v-else :size="16" fill="currentColor" />
        </button>
        <span class="replay-clock mono">{{ formatSeconds(time) }}</span>
        <input aria-label="回放进度" class="replay-range" type="range" min="0" :max="run.duration || 0.01" step="0.01" :value="time"
          @input="emit('seek', Number(($event.target as HTMLInputElement).value))" />
        <span class="replay-clock mono">{{ formatSeconds(run.duration) }}</span>
      </div>
      <div class="event-list-heading"><span>事件轨迹</span><span>{{ events.length }} EVENTS</span></div>
      <ol class="event-list">
        <li v-for="event in events" :key="event.id">
          <button class="event-row" :class="{ current: currentEvent?.id === event.id, interrupted: event.kind === 'interrupted' }"
            :aria-current="currentEvent?.id === event.id ? 'step' : undefined" @click="emit('event', event.id)">
            <span class="event-time mono">{{ formatSeconds(event.time) }}</span>
            <span class="event-icon"><component :is="iconFor(event.kind)" :size="14" /></span>
            <span class="event-copy"><strong>{{ run.events.find(item => item.id === event.id)?.pieceId === run.startPieceId ? '启动点' : event.detail.split(' · ')[0] }}</strong><small>{{ event.detail.split(' · ')[1] ?? event.pieceId }}</small></span>
            <span v-if="event.kind === 'interrupted'" class="event-flag">中断</span>
          </button>
        </li>
      </ol>
      <div v-if="run.interruptedPieceId" class="interruption-card">
        <span class="interrupt-icon"><AlertTriangle :size="16" /></span>
        <div><strong>中断位置</strong><p>{{ run.events.find(event => event.kind === 'interrupted')?.pieceId }} 未触及下一件元件。返回场景调整间距或方向，再次模拟。</p></div>
        <button :aria-label="'定位到 ' + run.interruptedPieceId" @click="emit('event', run.events.find(event => event.kind === 'interrupted')?.id ?? '')">定位</button>
      </div>
      <div v-if="stale" class="stale-note"><RotateCcw :size="13" /> 当前布局已改变，这份结果仍对应运行时保存的场景。</div>
    </template>
    <div v-else class="replay-empty">
      <div class="empty-orbit"><i></i><i></i><i></i><span></span></div>
      <strong>等待第一次模拟</strong><p>点击「运行模拟」，倒下顺序与中断位置会显示在这里。</p>
    </div>
  </section>
</template>

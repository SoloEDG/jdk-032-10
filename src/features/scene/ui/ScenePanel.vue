<script setup lang="ts">
import { Mountain, Ruler, SunMedium } from '@lucide/vue'
import type { SceneSettings } from '@/shared/document'
import { createDefaultGrounds } from '@/shared/calibration'

defineProps<{ scene: SceneSettings }>()
const emit = defineEmits<{ update: [Partial<SceneSettings>] }>()
const grounds = createDefaultGrounds()
function number(event: Event) { return Number((event.target as HTMLInputElement).value) }
function chooseGround(event: Event) {
  const groundId = (event.target as HTMLSelectElement).value
  const ground = grounds.find(item => item.id === groundId)
  emit('update', ground ? { groundId, friction: ground.friction } : { groundId })
}
</script>

<template>
  <section class="scene-panel">
    <div class="section-kicker"><span>04 / SCENE</span><h2>场景控制</h2></div>
    <div class="scene-dimensions"><Ruler :size="16" /><strong>{{ scene.width }} × {{ scene.height }}</strong><span>米</span></div>
    <label class="field-label ground-field"><span><Mountain :size="14" /> 使用地面</span>
      <select :value="scene.groundId" @change="chooseGround">
        <option v-for="ground in grounds" :key="ground.id" :value="ground.id">{{ ground.name }} · μ{{ ground.friction.toFixed(2) }}</option>
      </select>
    </label>
    <label class="field-label"><span><SunMedium :size="14" /> 重力</span><span>{{ scene.gravity.toFixed(1) }} m/s²</span>
      <input type="range" min="3" max="16" step="0.1" :value="scene.gravity" @change="emit('update', { gravity: number($event) })" />
    </label>
    <label class="field-label"><span><Mountain :size="14" /> 地面摩擦</span><span>{{ scene.friction.toFixed(2) }}</span>
      <input type="range" min="0.15" max="0.95" step="0.01" :value="scene.friction" @change="emit('update', { friction: number($event) })" />
    </label>
    <label class="grid-switch"><span>显示定位网格</span><input type="checkbox" :checked="scene.showGrid" @change="emit('update', { showGrid: ($event.target as HTMLInputElement).checked })" /><i></i></label>
  </section>
</template>

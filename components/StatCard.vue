<script setup lang="ts">
interface Props {
  title: string
  value: number | string
  icon: string
  color?: string
}

const props = withDefaults(defineProps<Props>(), {
  color: 'cyan'
})

const colorMap: Record<string, { text: string; bg: string; ring: string }> = {
  cyan: { text: 'text-cyan-400', bg: 'bg-cyan-500/10', ring: 'ring-cyan-500/20' },
  green: { text: 'text-green-400', bg: 'bg-green-500/10', ring: 'ring-green-500/20' },
  orange: { text: 'text-orange-400', bg: 'bg-orange-500/10', ring: 'ring-orange-500/20' },
  red: { text: 'text-red-400', bg: 'bg-red-500/10', ring: 'ring-red-500/20' },
  blue: { text: 'text-blue-400', bg: 'bg-blue-500/10', ring: 'ring-blue-500/20' }
}

const colors = computed(() => colorMap[props.color] ?? colorMap.cyan)
</script>

<template>
  <div
    class="relative overflow-hidden rounded-lg bg-[#1e1e3a] ring-1 ring-white/5 p-5 hover:ring-white/10 transition-all"
  >
    <div class="flex items-start justify-between">
      <div class="min-w-0 flex-1">
        <p class="text-xs font-medium uppercase tracking-wider text-slate-400">
          {{ title }}
        </p>
        <p class="mt-2 text-3xl font-bold tabular-nums text-slate-100">
          {{ value }}
        </p>
      </div>
      <div
        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ring-1"
        :class="[colors.bg, colors.text, colors.ring]"
      >
        <UIcon :name="icon" class="h-6 w-6" />
      </div>
    </div>
  </div>
</template>

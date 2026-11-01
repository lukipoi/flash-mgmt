<script setup lang="ts">
// 统计卡片 —— Endfield 母题范本
// 设计系统：endfield-ui（语义令牌 + 母题工具类，已在 assets/css/endfield 接入）。
// 其余卡片 / 面板照此套用 corner-brackets + tone 配色即可，方便后续美术 agent 统一接入。

type Tone = 'action' | 'data' | 'region' | 'gain' | 'notice' | 'special' | 'alert'

interface Props {
  title: string
  value: number | string
  icon: string
  tone?: Tone
}

const props = withDefaults(defineProps<Props>(), {
  tone: 'action'
})

// Endfield 角色色 → 图标徽章配色（直接吃已注册的 design token，
// 见 theme.css 的 --color-action / --color-data / --color-region / --color-gain ...
// Tailwind 会据此自动生成 text-* / bg-*/10 / ring-*/30 工具类）。
const toneMap: Record<Tone, { text: string; bg: string; ring: string }> = {
  action:  { text: 'text-action',  bg: 'bg-action/10',  ring: 'ring-action/30' },
  data:    { text: 'text-data',    bg: 'bg-data/10',    ring: 'ring-data/30' },
  region:  { text: 'text-region',  bg: 'bg-region/10',  ring: 'ring-region/30' },
  gain:    { text: 'text-gain',    bg: 'bg-gain/10',    ring: 'ring-gain/30' },
  notice:  { text: 'text-notice',  bg: 'bg-notice/10',  ring: 'ring-notice/30' },
  special: { text: 'text-special', bg: 'bg-special/10', ring: 'ring-special/30' },
  alert:   { text: 'text-alert',   bg: 'bg-alert/10',   ring: 'ring-alert/30' }
}

const tone = computed(() => toneMap[props.tone] ?? toneMap.action)
</script>

<template>
  <!--
    corner-brackets：四角角括号（Endfield 标志母题）。
    注意：其 ::after 伪元素向外侧伸出 --bracket-offset（默认 4px），
    因此父级必须是 relative 且【不能】有 overflow-hidden，否则角括号会被裁掉。
    --bracket-color 用信号黄（--ef-action），统一卡片外框色调。
  -->
  <div
    class="relative rounded-md bg-surface-raised p-5 ring-1 ring-line corner-brackets transition-all duration-fast hover:-translate-y-0.5 hover:ring-line-strong"
    style="--bracket-color: var(--ef-action)"
  >
    <div class="flex items-start justify-between">
      <div class="min-w-0 flex-1">
        <p class="text-xs font-medium uppercase tracking-label text-ink-tertiary">
          {{ title }}
        </p>
        <p class="mt-2 text-3xl font-bold tabular-nums text-ink">
          {{ value }}
        </p>
      </div>
      <div
        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-md ring-1"
        :class="[tone.bg, tone.text, tone.ring]"
      >
        <UIcon :name="icon" class="h-6 w-6" />
      </div>
    </div>
  </div>
</template>

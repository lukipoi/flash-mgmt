<script setup lang="ts">
interface Props {
  data: string | null
  maxBytes?: number
}

const props = withDefaults(defineProps<Props>(), {
  maxBytes: 64
})

interface HexLine {
  offset: string
  hex: string
  ascii: string
}

const lines = computed<HexLine[]>(() => {
  if (!props.data) return []
  const hex = props.data.replace(/\s+/g, '')
  if (!hex || !/^[0-9a-fA-F]+$/.test(hex)) return []

  const bytes = hex.match(/.{2}/g) ?? []
  const truncated = bytes.slice(0, props.maxBytes)

  const result: HexLine[] = []
  for (let i = 0; i < truncated.length; i += 16) {
    const chunk = truncated.slice(i, i + 16)
    const hexPart = chunk.map(b => b.toUpperCase()).join(' ')
    const hexPadded = hexPart.padEnd(47, ' ')
    const asciiPart = chunk
      .map(b => {
        const code = parseInt(b, 16)
        return code >= 32 && code <= 126 ? String.fromCharCode(code) : '.'
      })
      .join('')
    result.push({
      offset: i.toString(16).padStart(8, '0').toUpperCase(),
      hex: hexPadded,
      ascii: asciiPart
    })
  }
  return result
})

const truncatedCount = computed(() => {
  if (!props.data) return 0
  const hex = props.data.replace(/\s+/g, '')
  const total = (hex.match(/.{2}/g) ?? []).length
  return Math.max(0, total - props.maxBytes)
})
</script>

<template>
  <div class="hex-viewer rounded-md bg-[#0d1117] ring-1 ring-white/5 p-3 overflow-x-auto">
    <div v-if="lines.length === 0" class="py-4 text-center text-sm text-slate-500">
      无数据
    </div>
    <div v-else>
      <div
        v-for="line in lines"
        :key="line.offset"
        class="flex gap-4 whitespace-nowrap"
      >
        <span class="hex-offset select-none">{{ line.offset }}</span>
        <span class="hex-bytes">{{ line.hex }}</span>
        <span class="hex-ascii select-none">{{ line.ascii }}</span>
      </div>
      <div v-if="truncatedCount > 0" class="mt-2 text-xs text-slate-500">
        … 还有 {{ truncatedCount }} 字节未显示
      </div>
    </div>
  </div>
</template>

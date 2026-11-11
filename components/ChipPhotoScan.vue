<script setup lang="ts">
/**
 * ChipPhotoScan —— 芯片原件照扫描（共享：录入页 / 详情页）
 *
 * 两种用法：
 *  - 传 chipId：确认后直接 POST /api/chips/<id>/photo 绑定（详情页补扫/重扫）
 *  - 不传：confirm 事件把 dataURL 交给父级（录入页随表单提交）
 * 扫描路径与扫码快扫一致：实验开关开 → eSCL 直连；关 → WIA。
 */
const props = defineProps<{ chipId?: number }>()
const emit = defineEmits<{
  confirm: [dataUrl: string]
  saved: []
}>()

const { flags } = useLab()

const open = defineModel<boolean>('open', { default: false })
const scanning = ref(false)
const preview = ref<string>('')
const meta = ref<{ width: number | null, height: number | null, elapsedMs: number } | null>(null)
const error = ref('')
const saving = ref(false)

async function scan() {
  if (scanning.value) return
  scanning.value = true
  error.value = ''
  preview.value = ''
  try {
    const body: Record<string, any> = { dpi: 200 }
    if (flags.value.esclStream) body.escl = LAB_DEFAULT_ESCL
    const res = await $fetch<{ image: string, width: number | null, height: number | null, elapsedMs: number }>(
      '/api/chips/photo/scan', { method: 'POST', body })
    preview.value = res.image
    meta.value = { width: res.width, height: res.height, elapsedMs: res.elapsedMs }
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || '扫描失败'
  } finally {
    scanning.value = false
  }
}

/** 打开即扫（首次） */
watch(open, (v) => {
  if (v && !preview.value && !scanning.value) scan()
})

async function confirm() {
  if (!preview.value || saving.value) return
  if (props.chipId) {
    saving.value = true
    try {
      await $fetch(`/api/chips/${props.chipId}/photo`, { method: 'POST', body: { image: preview.value } })
      toast.add({ title: '原件照片已保存', color: 'success' })
      open.value = false
      emit('saved')
    } catch (e: any) {
      error.value = e?.data?.statusMessage || e?.message || '保存失败'
    } finally {
      saving.value = false
    }
  } else {
    emit('confirm', preview.value)
    open.value = false
  }
}

function discard() {
  preview.value = ''
  meta.value = null
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" title="芯片原件照片" :dismissible="!scanning">
    <template #body>
      <div class="space-y-3">
        <div v-if="scanning" class="flex h-64 items-center justify-center rounded-md border border-special-500/10 bg-surface-muted">
          <div class="flex flex-col items-center gap-2 text-sm text-ink-secondary">
            <UIcon name="i-lucide-loader-circle" class="h-6 w-6 animate-spin text-action" />
            <span>扫描中…（整面 200dpi，约 6~8 秒）</span>
          </div>
        </div>
        <template v-else-if="preview">
          <img :src="preview" alt="芯片原件照片预览" class="max-h-80 w-full rounded-md border border-special-500/10 object-contain" />
          <p class="text-xs text-ink-tertiary">
            {{ meta?.width }}×{{ meta?.height }}px · 已自动裁白边 · {{ ((meta?.elapsedMs || 0) / 1000).toFixed(1) }}s
          </p>
        </template>
        <div v-else class="flex h-40 items-center justify-center rounded-md border border-special-500/10 bg-surface-muted text-sm text-ink-tertiary">
          芯片放玻璃板（丝印朝下）后点「扫描」
        </div>
        <p v-if="error" class="rounded-md bg-alert-500/10 px-3 py-2 text-xs text-alert-300">{{ error }}</p>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full items-center justify-between">
        <UButton
          icon="i-lucide-scanner-line"
          color="neutral"
          variant="ghost"
          size="xs"
          :loading="scanning"
          @click="scan"
        >
          {{ preview ? '重扫' : '扫描' }}
        </UButton>
        <div class="flex gap-2">
          <UButton color="neutral" variant="ghost" size="xs" :disabled="scanning || saving" @click="discard">
            取消
          </UButton>
          <UButton
            icon="i-lucide-check"
            color="action"
            size="xs"
            :disabled="!preview || scanning"
            :loading="saving"
            @click="confirm"
          >
            {{ chipId ? '保存照片' : '采用这张' }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
/**
 * 新增封装弹窗（封装图绑定通道）
 * - 名称必填；与内置封装重名时作为「补图/补别名」覆盖条目（server 端走 UPDATE）
 * - 别名可选（逗号分隔），用于大小写/连字符混写归一匹配
 * - 封装图可选上传（png/jpg/svg/webp ≤2MB），alpha 透明底直接展示
 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  added: [name: string]
}>()

const form = reactive({
  name: '',
  aliases: '',
  imageFile: null as File | null
})
const submitting = ref(false)
const errorMsg = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

function onFileChange(e: Event) {
  const files = (e.target as HTMLInputElement).files
  form.imageFile = files?.[0] ?? null
}

function close() {
  emit('update:open', false)
}

watch(() => props.open, (val) => {
  if (val) {
    form.name = ''
    form.aliases = ''
    form.imageFile = null
    errorMsg.value = null
  }
})

async function submit() {
  errorMsg.value = null
  const name = form.name.trim()
  if (!name) {
    errorMsg.value = '封装名必填'
    return
  }
  submitting.value = true
  try {
    const fd = new FormData()
    fd.append('name', name)
    if (form.aliases.trim()) fd.append('aliases', form.aliases.trim())
    if (form.imageFile) fd.append('image', form.imageFile)
    await $fetch('/api/packages', { method: 'POST', body: fd })
    emit('added', name)
    close()
  } catch (e: any) {
    errorMsg.value = e?.data?.statusMessage || e?.message || '添加失败'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal :open="open" title="新增封装 / 补图" @update:open="(v: boolean) => { if (!v) close() }">
    <template #body>
      <div class="space-y-4">
        <div>
          <label class="mb-1.5 block text-sm font-medium text-ink-secondary">封装名（规范名）</label>
          <UInput
            v-model="form.name"
            placeholder="如: SOP-8 / WSON-8，保存后以此名为准"
            class="w-full"
            :disabled="submitting"
          />
          <p class="mt-1 text-xs text-ink-tertiary">与内置封装重名时，将作为补图/补别名覆盖内置条目</p>
        </div>
        <div>
          <label class="mb-1.5 block text-sm font-medium text-ink-secondary">别名（可选，逗号分隔）</label>
          <UInput
            v-model="form.aliases"
            placeholder="如: sop8, soic-8, so 8"
            class="w-full"
            :disabled="submitting"
          />
          <p class="mt-1 text-xs text-ink-tertiary">录入芯片按别名归一，防止大小写/连字符混写</p>
        </div>
        <div>
          <label class="mb-1.5 block text-sm font-medium text-ink-secondary">封装图（可选，png/svg/jpg/webp ≤2MB，透明底）</label>
          <input
            ref="fileInput"
            type="file"
            accept=".png,.jpg,.jpeg,.svg,.webp"
            class="block w-full cursor-pointer rounded-md bg-surface-muted text-sm text-ink-secondary ring-1 ring-line file:mr-3 file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm file:text-ink"
            :disabled="submitting"
            @change="onFileChange"
          >
        </div>
        <div v-if="errorMsg" class="rounded-md bg-alert-500/10 p-3 text-sm text-alert-300 ring-1 ring-alert-500/20">
          {{ errorMsg }}
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" :disabled="submitting" @click="close">
          取消
        </UButton>
        <UButton color="primary" variant="solid" :loading="submitting" @click="submit">
          添加
        </UButton>
      </div>
    </template>
  </UModal>
</template>

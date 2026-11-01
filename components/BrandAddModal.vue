<script setup lang="ts">
/**
 * 新增/编辑品牌弹窗（logo 绑定通道）
 * - 名称必填，防重（内置品牌 + 已录入手动品牌，大小写不敏感）
 * - 别名可选（逗号分隔），用于大小写/中英文归一匹配
 * - logo 可选上传（png/jpg/svg/webp ≤2MB），alpha 透明底直接展示
 * - editTarget 传入时进入编辑模式：手动品牌可改名；内置品牌名不可改（仅补 logo/别名）
 */
export interface BrandEditTarget {
  name: string
  aliases: string
  logo: string | null
  builtin: boolean
}

const props = defineProps<{
  open: boolean
  editTarget?: BrandEditTarget | null
}>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  added: [name: string]
}>()

const form = reactive({
  name: '',
  aliases: '',
  logoFile: null as File | null
})
const submitting = ref(false)
const errorMsg = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const isEdit = computed(() => !!props.editTarget)
const nameDisabled = computed(() => submitting.value || (isEdit.value && props.editTarget?.builtin === true))

function onFileChange(e: Event) {
  const files = (e.target as HTMLInputElement).files
  form.logoFile = files?.[0] ?? null
}

function close() {
  emit('update:open', false)
}

watch(() => props.open, (val) => {
  if (val) {
    // 编辑模式预填原值；新增清空
    form.name = props.editTarget?.name ?? ''
    form.aliases = props.editTarget?.aliases ?? ''
    form.logoFile = null
    errorMsg.value = null
  }
})

async function submit() {
  errorMsg.value = null
  const name = form.name.trim()
  if (!name) {
    errorMsg.value = '品牌名必填'
    return
  }
  submitting.value = true
  try {
    const fd = new FormData()
    fd.append('name', name)
    if (form.aliases.trim()) fd.append('aliases', form.aliases.trim())
    if (form.logoFile) fd.append('logo', form.logoFile)
    // 编辑且改名时回传原名，服务端按原名定位记录
    if (isEdit.value && props.editTarget && props.editTarget.name !== name) {
      fd.append('original_name', props.editTarget.name)
    }
    else if (isEdit.value && props.editTarget && !props.editTarget.builtin) {
      // 手动品牌编辑（未改名）也走原名定位
      fd.append('original_name', props.editTarget.name)
    }
    await $fetch('/api/brands', { method: 'POST', body: fd })
    emit('added', name)
    close()
  } catch (e: any) {
    errorMsg.value = e?.data?.statusMessage || e?.message || '保存失败'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal :open="open" :title="isEdit ? '编辑品牌' : '新增品牌'" @update:open="(v: boolean) => { if (!v) close() }">
    <template #body>
      <div class="space-y-4">
        <div>
          <label class="mb-1.5 block text-sm font-medium text-ink-secondary">品牌名（规范名）</label>
          <UInput
            v-model="form.name"
            placeholder="如: Puya / Winbond，保存后以此名为准"
            class="w-full"
            :disabled="nameDisabled"
          />
          <p v-if="isEdit && editTarget?.builtin" class="mt-1 text-xs text-ink-tertiary">内置品牌名不可修改，可补充别名和 logo</p>
        </div>
        <div>
          <label class="mb-1.5 block text-sm font-medium text-ink-secondary">别名（可选，逗号分隔）</label>
          <UInput
            v-model="form.aliases"
            placeholder="如: 普冉, puya semiconductor"
            class="w-full"
            :disabled="submitting"
          />
          <p class="mt-1 text-xs text-ink-tertiary">录入芯片按别名归一，防止大小写/中英文混用</p>
        </div>
        <div>
          <label class="mb-1.5 block text-sm font-medium text-ink-secondary">Logo（可选，png/svg/jpg/webp ≤2MB，透明底）</label>
          <input
            ref="fileInput"
            type="file"
            accept=".png,.jpg,.jpeg,.svg,.webp"
            class="block w-full cursor-pointer rounded-md bg-surface-muted text-sm text-ink-secondary ring-1 ring-line file:mr-3 file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm file:text-ink"
            :disabled="submitting"
            @change="onFileChange"
          >
          <p v-if="isEdit && editTarget?.logo" class="mt-1 text-xs text-ink-tertiary">不上传新文件则保留当前 logo</p>
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
          {{ isEdit ? '保存' : '添加' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>

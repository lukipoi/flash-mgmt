<script setup lang="ts">
import type { Equipment, EquipmentStatus } from '~~/shared/types'

definePageMeta({
  title: '录入设备'
})

const STATUS_OPTIONS = [
  { label: '正常', value: 'normal' },
  { label: '损坏', value: 'damaged' },
  { label: '丢失', value: 'lost' }
]

const form = reactive({
  brand: '',
  model: '',
  serial_number: '',
  status: 'normal' as EquipmentStatus,
  note: ''
})

const submitting = ref(false)
const submitError = ref<string | null>(null)

const errors = computed(() => {
  const e: Record<string, string> = {}
  if (!form.model.trim()) e.model = '型号为必填项'
  return e
})

const isValid = computed(() => Object.keys(errors.value).length === 0)

async function submit() {
  if (!isValid.value) return
  submitting.value = true
  submitError.value = null
  try {
    const result = await $fetch<Equipment>('/api/equipment', {
      method: 'POST',
      body: {
        brand: form.brand.trim() || null,
        model: form.model.trim(),
        serial_number: form.serial_number.trim() || null,
        status: form.status,
        note: form.note.trim() || null
      }
    })
    navigateTo(`/equipment`)
  } catch (e: any) {
    submitError.value = e.data?.message || e.message || '提交失败'
  } finally {
    submitting.value = false
  }
}

function resetForm() {
  form.brand = ''
  form.model = ''
  form.serial_number = ''
  form.status = 'normal'
  form.note = ''
  submitError.value = null
}
</script>

<template>
  <div class="min-h-full p-6">
    <!-- 页头 -->
    <div class="mb-6 flex items-center gap-3">
      <UButton
        to="/equipment"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        size="sm"
      />
      <div>
        <h2 class="text-xl font-bold text-ink">录入设备</h2>
        <p class="mt-1 text-sm text-ink-tertiary">在库硬件设备登记</p>
      </div>
    </div>

    <!-- 表单 -->
    <div class="max-w-2xl rounded-lg bg-surface-raised p-6 ring-1 ring-line">
      <div class="space-y-5">
        <!-- 品牌 + 型号 -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">品牌</label>
            <UInput
              v-model="form.brand"
              placeholder="如: CH347 / Keysight / Tektronix"
              class="w-full"
            />
          </div>
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">
              型号 <span class="text-alert-400">*</span>
            </label>
            <UInput
              v-model="form.model"
              placeholder="如: CH347T Mini / DSO138"
              class="w-full"
              :class="{ 'ring-1 ring-alert-500/50': errors.model }"
            />
            <p v-if="errors.model" class="mt-1 text-xs text-alert-400">{{ errors.model }}</p>
          </div>
        </div>

        <!-- 序列号 + 状态 -->
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">序列号</label>
            <UInput
              v-model="form.serial_number"
              placeholder="设备出厂序列号，可留空"
              class="w-full font-mono"
            />
          </div>
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">状态</label>
            <USelect
              v-model="form.status"
              :items="STATUS_OPTIONS"
              class="w-full"
            />
          </div>
        </div>

        <!-- 备注 -->
        <div>
          <label class="mb-1.5 block text-sm font-medium text-ink-secondary">备注</label>
          <UTextarea
            v-model="form.note"
            placeholder="可选备注信息..."
            class="w-full"
            :rows="3"
          />
        </div>

        <!-- 提交错误 -->
        <div
          v-if="submitError"
          class="flex items-center gap-2 rounded-md bg-alert-500/10 p-3 ring-1 ring-alert-500/20"
        >
          <UIcon name="i-lucide-alert-circle" class="h-5 w-5 shrink-0 text-alert-400" />
          <span class="text-sm text-alert-300">{{ submitError }}</span>
        </div>

        <!-- 操作按钮 -->
        <div class="flex items-center justify-end gap-3 pt-2">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            @click="resetForm"
          >
            重置
          </UButton>
          <UButton
            color="primary"
            variant="solid"
            size="sm"
            icon="i-lucide-check"
            :loading="submitting"
            :disabled="!isValid || submitting"
            @click="submit"
          >
            提交录入
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>

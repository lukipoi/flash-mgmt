<script setup lang="ts">
import type { CircuitBoard, CircuitBoardStatus } from '~~/shared/types'

definePageMeta({
  title: '录入电路板'
})

const STATUS_OPTIONS = [
  { label: '待拆解', value: 'pending' },
  { label: '部分拆解', value: 'partial' },
  { label: '已拆解', value: 'done' }
]

// 表单同时维护数组（提交用）和逗号分隔字符串（输入用）
const form = reactive({
  brand: '',
  model: '',
  serial_number: '',
  status: 'pending' as CircuitBoardStatus,
  note: ''
})

const chipsText = ref('')

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
    const chipsArr = chipsText.value
      .split(/[,，]/)
      .map(s => s.trim())
      .filter(Boolean)

    await $fetch<CircuitBoard>('/api/boards', {
      method: 'POST',
      body: {
        brand: form.brand.trim() || null,
        model: form.model.trim(),
        serial_number: form.serial_number.trim() || null,
        status: form.status,
        chips: chipsArr.length ? chipsArr : null,
        note: form.note.trim() || null
      }
    })
    navigateTo(`/boards`)
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
  form.status = 'pending'
  form.note = ''
  chipsText.value = ''
  submitError.value = null
}
</script>

<template>
  <div class="min-h-full p-6">
    <!-- 页头 -->
    <div class="mb-6 flex items-center gap-3">
      <UButton
        to="/boards"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        size="sm"
      />
      <div>
        <h2 class="text-xl font-bold text-ink">录入电路板</h2>
        <p class="mt-1 text-sm text-ink-tertiary">记录拆下来的待处理板子</p>
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
              placeholder="如: Arduino / ST / 拆机来源"
              class="w-full"
            />
          </div>
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">
              型号 <span class="text-alert-400">*</span>
            </label>
            <UInput
              v-model="form.model"
              placeholder="如: UNO R3 / 自研板 V1.0"
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
              placeholder="可留空"
              class="w-full font-mono"
            />
          </div>
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">拆解状态</label>
            <USelect
              v-model="form.status"
              :items="STATUS_OPTIONS"
              class="w-full"
            />
          </div>
        </div>

        <!-- 板载芯片 -->
        <div>
          <label class="mb-1.5 block text-sm font-medium text-ink-secondary">
            板载主要芯片 <span class="text-xs text-ink-tertiary">（逗号分隔，可留空）</span>
          </label>
          <UInput
            v-model="chipsText"
            placeholder="如: STM32F103C8T6, W5500, CH340C"
            class="w-full font-mono text-xs"
          />
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

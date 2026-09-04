<script setup lang="ts">
import type { Chip, ProbeResult } from '~~/shared/types'

interface IdentifyResult {
  matched: boolean
  match_by: 'uid' | 'jedec_id' | null
  reason?: string
  chip?: Chip
  candidates?: { id: number; model: string; jedec_id: string; uid: string; uid_length: number; capacity: string; created_at: string; chip_type?: string }[]
}

definePageMeta({
  title: '录入芯片'
})

const mode = ref<'auto' | 'manual'>('auto')
const chipType = ref<'flash' | 'mcu'>('flash')

// ---- 自动录入 (Probe) ----
const probing = ref(false)
const probeResult = ref<ProbeResult | null>(null)
const probeError = ref<string | null>(null)
const identifyResult = ref<IdentifyResult | null>(null)
let userDismissedIdentify = false

// 从 sessionStorage 恢复识别结果
onMounted(() => {
  try {
    const saved = sessionStorage.getItem('new-identify-result')
    if (saved) {
      identifyResult.value = JSON.parse(saved)
    }
    const savedProbe = sessionStorage.getItem('new-probe-result')
    if (savedProbe) {
      probeResult.value = JSON.parse(savedProbe)
    }
  } catch {
    // ignore
  }
})

// 持久化识别结果和探测结果（仅在非用户关闭时更新）
watch(identifyResult, (val) => {
  if (userDismissedIdentify) {
    try { sessionStorage.removeItem('new-identify-result') } catch { /* ignore */ }
    userDismissedIdentify = false
    return
  }
  try {
    if (val) {
      sessionStorage.setItem('new-identify-result', JSON.stringify(val))
    }
  } catch { /* ignore */ }
})

watch(probeResult, (val) => {
  try {
    if (val) {
      sessionStorage.setItem('new-probe-result', JSON.stringify(val))
    }
  } catch { /* ignore */ }
})

async function probe() {
  probing.value = true
  probeError.value = null
  probeResult.value = null
  identifyResult.value = null
  try {
    const result = await $fetch<ProbeResult>('/api/probe', { method: 'POST' })
    probeResult.value = result
    if (result.error) {
      probeError.value = result.error
      return
    }

    // 根据 JEDEC ID 判断芯片类型
    const jedecId = (result.jedec_id || '').trim()
    chipType.value = jedecId ? 'flash' : 'mcu'

    const identify = await $fetch<IdentifyResult>('/api/identify', {
      method: 'POST',
      body: {
        jedec_id: result.jedec_id,
        uid: result.uid,
        uid_length: result.uid_length,
        chip_type: chipType.value
      }
    })
    identifyResult.value = identify

    if (identify.matched && identify.chip) {
      return
    }

    form.model = result.model || identify.candidates?.[0]?.model || ''
    form.chip_type = chipType.value
    form.jedec_id = result.jedec_id
    form.uid = result.uid
    form.uid_length = result.uid_length
    form.capacity = jedecIdToCapacity(result.jedec_id) || ''
    mode.value = 'manual'
  } catch (e: any) {
    probeError.value = e.data?.message || e.message || '读取芯片失败'
  } finally {
    probing.value = false
  }
}

function goToMatchedChip() {
  if (identifyResult.value?.chip) {
    navigateTo(`/chips/${identifyResult.value.chip.id}`)
  }
}

function startNewArchive() {
  if (probeResult.value) {
    form.model = identifyResult.value?.candidates?.[0]?.model || ''
    form.chip_type = chipType.value
    form.jedec_id = probeResult.value.jedec_id
    form.uid = probeResult.value.uid
    form.uid_length = probeResult.value.uid_length
    form.capacity = jedecIdToCapacity(probeResult.value.jedec_id) || ''
  }
  userDismissedIdentify = true
  identifyResult.value = null
  mode.value = 'manual'
}

// ---- 手动录入表单 ----
const form = reactive({
  model: '',
  chip_type: 'flash' as 'flash' | 'mcu',
  jedec_id: '',
  uid: '',
  uid_length: 8,
  capacity: '',
  note: ''
})

// JEDEC ID 变化时自动识别容量（仅在容量为空时）
watch(() => form.jedec_id, (val) => {
  if (val && form.chip_type === 'flash' && !form.capacity) {
    const cap = jedecIdToCapacity(val)
    if (cap) form.capacity = cap
  }
})

const submitting = ref(false)
const submitError = ref<string | null>(null)

const errors = computed(() => {
  const e: Record<string, string> = {}
  if (!form.model.trim()) e.model = '型号为必填项'

  if (form.chip_type === 'flash') {
    // Flash: JEDEC ID 必填 + 合法性校验
    const jedecCheck = isValidJedecId(form.jedec_id)
    if (!jedecCheck.valid && jedecCheck.error) e.jedec_id = jedecCheck.error
  } else if (form.jedec_id.trim()) {
    // MCU: 填了就校验合法性，没填跳过
    if (!isValidHex(form.jedec_id)) e.jedec_id = '只能包含十六进制字符 (0-9, A-F)'
  }

  const uidCheck = isValidUid(form.uid, Number(form.uid_length))
  if (!uidCheck.valid && uidCheck.error) e.uid = uidCheck.error

  return e
})

const isValid = computed(() => Object.keys(errors.value).length === 0)

async function submit() {
  if (!isValid.value) return
  submitting.value = true
  submitError.value = null
  try {
    const result = await $fetch<Chip>('/api/chips', {
      method: 'POST',
      body: {
        model: form.model.trim(),
        chip_type: form.chip_type,
        jedec_id: form.jedec_id.trim(),
        uid: form.uid.trim(),
        uid_length: Number(form.uid_length),
        capacity: form.capacity.trim() || null,
        note: form.note.trim() || null
      }
    })
    navigateTo(`/chips/${result.id}`)
  } catch (e: any) {
    submitError.value = e.data?.message || e.message || '提交失败'
  } finally {
    submitting.value = false
  }
}

function resetForm() {
  form.model = ''
  form.chip_type = 'flash'
  form.jedec_id = ''
  form.uid = ''
  form.uid_length = 8
  form.capacity = ''
  form.note = ''
  submitError.value = null
  userDismissedIdentify = true
  probeResult.value = null
  probeError.value = null
  identifyResult.value = null
  try { sessionStorage.removeItem('new-probe-result') } catch { /* ignore */ }
}
</script>

<template>
  <div class="min-h-full p-6">
    <!-- 页头 -->
    <div class="mb-6 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <UButton
          to="/chips"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          size="sm"
        />
        <div>
          <h2 class="text-xl font-bold text-slate-100">录入芯片</h2>
          <p class="mt-1 text-sm text-slate-500">通过 CH341 读取或手动录入新芯片</p>
        </div>
      </div>
    </div>

    <!-- 模式切换 -->
    <div class="mb-6 inline-flex rounded-lg bg-[#1e1e3a] p-1 ring-1 ring-white/5">
      <button
        class="rounded-md px-4 py-2 text-sm font-medium transition-colors"
        :class="mode === 'auto' ? 'bg-cyan-500/15 text-cyan-400' : 'text-slate-400 hover:text-slate-200'"
        @click="mode = 'auto'"
      >
        <UIcon name="i-lucide-radio" class="mr-2 inline h-4 w-4" />
        自动录入
      </button>
      <button
        class="rounded-md px-4 py-2 text-sm font-medium transition-colors"
        :class="mode === 'manual' ? 'bg-cyan-500/15 text-cyan-400' : 'text-slate-400 hover:text-slate-200'"
        @click="mode = 'manual'"
      >
        <UIcon name="i-lucide-pencil" class="mr-2 inline h-4 w-4" />
        手动录入
      </button>
    </div>

    <!-- 自动录入模式 -->
    <div v-if="mode === 'auto'" class="max-w-2xl">
      <div class="rounded-lg bg-[#1e1e3a] p-8 ring-1 ring-white/5">
        <div class="text-center">
          <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-cyan-500/10 ring-1 ring-cyan-500/20">
            <UIcon name="i-lucide-radio" class="h-8 w-8 text-cyan-400" :class="{ 'animate-pulse': probing }" />
          </div>
          <h3 class="text-lg font-semibold text-slate-100">读取芯片</h3>
          <p class="mt-1 text-sm text-slate-500">
            将芯片连接到 CH341 编程器，然后点击下方按钮读取芯片信息
          </p>
        </div>

        <div class="mt-6 flex justify-center">
          <UButton
            size="lg"
            color="primary"
            variant="solid"
            icon="i-lucide-zap"
            :loading="probing"
            :disabled="probing"
            @click="probe"
          >
            {{ probing ? '正在读取...' : '读取芯片' }}
          </UButton>
        </div>

        <!-- 读取结果 -->
        <div v-if="probeResult && !probeError" class="mt-6 space-y-3">
          <div class="rounded-md bg-white/5 p-4 ring-1 ring-white/10">
            <div class="mb-3 flex items-center gap-2">
              <UIcon name="i-lucide-check-circle" class="h-5 w-5 text-green-400" />
              <span class="text-sm font-medium text-green-300">读取成功</span>
            </div>
            <dl class="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt class="text-xs text-slate-500">类型</dt>
                <dd class="font-mono" :class="chipType === 'mcu' ? 'text-purple-400' : 'text-cyan-400'">
                  {{ chipType === 'mcu' ? 'MCU 单片机' : 'Flash 存储' }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">JEDEC ID</dt>
                <dd class="font-mono text-cyan-400">{{ formatJedecId(probeResult.jedec_id) }}</dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">UID</dt>
                <dd class="font-mono text-cyan-400">{{ formatUid(probeResult.uid) }}</dd>
              </div>
              <div>
                <dt class="text-xs text-slate-500">UID 长度</dt>
                <dd class="font-mono text-slate-300">{{ probeResult.uid_length }}</dd>
              </div>
            </dl>
          </div>

          <!-- 档案命中 -->
          <div
            v-if="identifyResult?.matched && identifyResult.chip"
            class="rounded-md bg-cyan-500/5 p-4 ring-1 ring-cyan-500/30"
          >
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-fingerprint" class="h-5 w-5 text-cyan-400" />
              <span class="text-sm font-semibold text-cyan-300">已识别档案</span>
              <UBadge color="info" variant="subtle" size="xs" class="font-mono">
                by {{ identifyResult.match_by }}
              </UBadge>
            </div>
            <div class="mt-3 space-y-1 rounded-md bg-white/5 p-3 font-mono text-xs text-slate-300">
              <div>型号：<span class="text-cyan-400">{{ identifyResult.chip.model }}</span></div>
              <div>类型：<span class="text-cyan-400">{{ identifyResult.chip.chip_type === 'mcu' ? 'MCU' : 'Flash' }}</span></div>
              <div>JEDEC ID：<span class="text-cyan-400">{{ formatJedecId(identifyResult.chip.jedec_id) }}</span></div>
              <div>容量：<span class="text-cyan-400">{{ identifyResult.chip.capacity || '-' }}</span></div>
              <div>创建于：<span class="text-slate-500">{{ formatDate(identifyResult.chip.created_at) }}</span></div>
            </div>
            <div class="mt-3 flex justify-end gap-2">
              <UButton
                color="primary"
                variant="solid"
                size="sm"
                icon="i-lucide-external-link"
                @click="goToMatchedChip"
              >
                查看档案详情
              </UButton>
            </div>
          </div>

          <!-- 档案未命中 -->
          <div
            v-else-if="identifyResult && !identifyResult.matched"
            class="rounded-md bg-amber-500/5 p-4 ring-1 ring-amber-500/30"
          >
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-package-plus" class="h-5 w-5 text-amber-400" />
              <span class="text-sm font-semibold text-amber-300">未识别到档案</span>
            </div>
            <p class="mt-2 text-sm text-slate-300">{{ identifyResult.reason }}</p>

            <!-- 同型号候选 -->
            <div v-if="identifyResult.candidates?.length" class="mt-3 space-y-2">
              <p class="text-xs text-slate-500">同 JEDEC ID 的已存在芯片：</p>
              <div
                v-for="c in identifyResult.candidates"
                :key="c.id"
                class="flex items-center justify-between rounded-md bg-white/5 p-2 text-xs"
              >
                <div class="font-mono text-slate-300">
                  <span class="text-slate-500">#{{ c.id }}</span>
                  <span class="ml-2 text-cyan-400">{{ c.model }}</span>
                  <span v-if="c.chip_type" class="ml-1" :class="c.chip_type === 'mcu' ? 'text-purple-400' : 'text-cyan-400'">[{{ c.chip_type === 'mcu' ? 'MCU' : 'Flash' }}]</span>
                  <span class="ml-2 text-slate-500">UID: {{ truncateUid(c.uid, 12) }}</span>
                </div>
                <UButton
                  :to="`/chips/${c.id}`"
                  variant="ghost"
                  size="xs"
                  color="neutral"
                >
                  查看
                </UButton>
              </div>
            </div>

            <div class="mt-3 flex justify-end">
              <UButton
                color="primary"
                variant="solid"
                size="sm"
                icon="i-lucide-plus"
                @click="startNewArchive"
              >
                创建新档案
              </UButton>
            </div>
          </div>
        </div>

        <!-- 读取错误 -->
        <div v-if="probeError" class="mt-6 rounded-md bg-red-500/5 p-4 ring-1 ring-red-500/20">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-alert-triangle" class="h-5 w-5 text-red-400" />
            <span class="text-sm font-medium text-red-300">读取失败</span>
          </div>
          <p class="mt-2 text-sm text-red-300">{{ probeError }}</p>
          <UButton
            size="sm"
            variant="link"
            color="neutral"
            class="mt-2"
            @click="mode = 'manual'"
          >
            改为手动录入 →
          </UButton>
        </div>
      </div>
    </div>

    <!-- 手动录入表单 -->
    <div v-else class="max-w-2xl">
      <div class="rounded-lg bg-[#1e1e3a] p-6 ring-1 ring-white/5">
        <div class="space-y-5">
          <!-- 芯片类型 -->
          <div>
            <label class="mb-1.5 block text-sm font-medium text-slate-300">
              芯片类型 <span class="text-red-400">*</span>
            </label>
            <div class="flex gap-3">
              <button
                type="button"
                class="flex-1 rounded-md border px-4 py-3 text-sm font-medium transition-colors"
                :class="form.chip_type === 'flash'
                  ? 'border-cyan-500 bg-cyan-500/10 text-cyan-400'
                  : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'"
                @click="form.chip_type = 'flash'"
              >
                <UIcon name="i-lucide-memory-stick" class="mr-2 inline h-4 w-4" />
                Flash 存储
              </button>
              <button
                type="button"
                class="flex-1 rounded-md border px-4 py-3 text-sm font-medium transition-colors"
                :class="form.chip_type === 'mcu'
                  ? 'border-purple-500 bg-purple-500/10 text-purple-400'
                  : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'"
                @click="form.chip_type = 'mcu'"
              >
                <UIcon name="i-lucide-cpu" class="mr-2 inline h-4 w-4" />
                MCU 单片机
              </button>
            </div>
          </div>

          <!-- 型号 -->
          <div>
            <label class="mb-1.5 block text-sm font-medium text-slate-300">
              型号 <span class="text-red-400">*</span>
            </label>
            <UInput
              v-model="form.model"
              :placeholder="form.chip_type === 'mcu' ? '如: STM32F103C8T6' : '如: W25Q128'"
              class="w-full"
              :class="{ 'ring-1 ring-red-500/50': errors.model }"
            />
            <p v-if="errors.model" class="mt-1 text-xs text-red-400">{{ errors.model }}</p>
          </div>

          <!-- JEDEC ID / 芯片 ID -->
          <div>
            <label class="mb-1.5 block text-sm font-medium text-slate-300">
              {{ form.chip_type === 'mcu' ? '芯片 ID' : 'JEDEC ID' }}
              <span v-if="form.chip_type === 'flash'" class="text-red-400">*</span>
            </label>
            <UInput
              v-model="form.jedec_id"
              :placeholder="form.chip_type === 'mcu' ? '如: STM32F103 或 留空' : '如: EF 40 18'"
              class="w-full font-mono"
              :class="{ 'ring-1 ring-red-500/50': errors.jedec_id }"
            />
            <p v-if="errors.jedec_id" class="mt-1 text-xs text-red-400">{{ errors.jedec_id }}</p>
            <p v-else-if="form.chip_type === 'mcu'" class="mt-1 text-xs text-slate-500">MCU 无 JEDEC ID，可填芯片系列标识或留空</p>
          </div>

          <!-- UID -->
          <div>
            <label class="mb-1.5 block text-sm font-medium text-slate-300">
              UID <span class="text-red-400">*</span>
            </label>
            <UInput
              v-model="form.uid"
              placeholder="如: DE AD BE EF 12 34 56 78"
              class="w-full font-mono"
              :class="{ 'ring-1 ring-red-500/50': errors.uid }"
            />
            <p v-if="errors.uid" class="mt-1 text-xs text-red-400">{{ errors.uid }}</p>
            <p class="mt-1 text-xs text-slate-500">格式: 十六进制，空格分隔</p>
          </div>

          <!-- UID 长度 + 容量 -->
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="mb-1.5 block text-sm font-medium text-slate-300">UID 长度</label>
              <UInput
                v-model.number="form.uid_length"
                type="number"
                placeholder="8"
                class="w-full"
              />
            </div>
            <div v-if="form.chip_type === 'flash'">
              <label class="mb-1.5 block text-sm font-medium text-slate-300">容量</label>
              <UInput
                v-model="form.capacity"
                placeholder="如: 16Mbit / 2MB"
                class="w-full"
              />
              <p class="mt-1 text-xs text-slate-500">根据 JEDEC ID 自动识别，可手动修改</p>
            </div>
          </div>

          <!-- 备注 -->
          <div>
            <label class="mb-1.5 block text-sm font-medium text-slate-300">备注</label>
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
            class="flex items-center gap-2 rounded-md bg-red-500/10 p-3 ring-1 ring-red-500/20"
          >
            <UIcon name="i-lucide-alert-circle" class="h-5 w-5 shrink-0 text-red-400" />
            <span class="text-sm text-red-300">{{ submitError }}</span>
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
  </div>
</template>

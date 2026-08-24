<script setup lang="ts">
import type { Chip, OperationLog } from '~~/shared/types'

interface ChipDetail extends Chip {
  operation_logs: OperationLog[]
}

const route = useRoute()
const chipId = route.params.id as string

const { data: chip, pending, error, refresh } = await useFetch<ChipDetail>(`/api/chips/${chipId}`)

const logs = computed(() => chip.value?.operation_logs ?? [])

const copied = ref(false)
const showDeleteModal = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

async function copyUid() {
  if (!chip.value?.uid) return
  try {
    await navigator.clipboard.writeText(chip.value.uid)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // 忽略剪贴板错误
  }
}

async function confirmDelete() {
  if (!chip.value) return
  deleting.value = true
  deleteError.value = null
  try {
    await $fetch(`/api/chips/${chip.value.id}`, { method: 'DELETE' })
    showDeleteModal.value = false
    await navigateTo('/chips')
  } catch (err: any) {
    deleteError.value = err?.statusMessage || err?.message || '删除失败'
  } finally {
    deleting.value = false
  }
}

// ---- 改备注 ----
const showNoteModal = ref(false)
const noteText = ref('')
const savingNote = ref(false)
const noteError = ref<string | null>(null)

async function saveNote() {
  if (!chip.value) return
  savingNote.value = true
  noteError.value = null
  try {
    await $fetch(`/api/chips/${chip.value.id}`, {
      method: 'PUT',
      body: { note: noteText.value.trim() }
    })
    showNoteModal.value = false
    await refresh()
  } catch (err: any) {
    noteError.value = err?.statusMessage || err?.message || '保存失败'
  } finally {
    savingNote.value = false
  }
}

// ---- 锁定 OTP ----
const showLockModal = ref(false)
const lockForm = reactive({ sec1: false, sec2: false, sec3: false })
const locking = ref(false)
const lockError = ref<string | null>(null)

async function saveLock() {
  if (!chip.value) return
  locking.value = true
  lockError.value = null
  try {
    await $fetch(`/api/chips/${chip.value.id}/lock`, {
      method: 'POST',
      body: {
        sec1: lockForm.sec1,
        sec2: lockForm.sec2,
        sec3: lockForm.sec3
      }
    })
    showLockModal.value = false
    await refresh()
  } catch (err: any) {
    lockError.value = err?.statusMessage || err?.message || '锁定失败'
  } finally {
    locking.value = false
  }
}

// ---- 写入 Flash ----
const showWriteModal = ref(false)
const writeFile = ref<File | null>(null)
const writeAddress = ref('0x00')
const writing = ref(false)
const writeError = ref<string | null>(null)

async function submitWrite() {
  if (!chip.value || !writeFile.value) return
  writing.value = true
  writeError.value = null
  try {
    const formData = new FormData()
    formData.append('file', writeFile.value)
    formData.append('address', writeAddress.value)
    await $fetch(`/api/chips/${chip.value.id}/write`, {
      method: 'POST',
      body: formData
    })
    showWriteModal.value = false
    writeFile.value = null
    writeAddress.value = '0x00'
    await refresh()
  } catch (err: any) {
    writeError.value = err?.statusMessage || err?.message || '写入失败'
  } finally {
    writing.value = false
  }
}

function operationColor(op: string): string {
  if (op.includes('lock') || op.includes('锁定')) return 'warning'
  if (op.includes('create') || op.includes('创建') || op.includes('录入')) return 'success'
  if (op.includes('delete') || op.includes('删除') || op.includes('destroy') || op.includes('销毁')) return 'error'
  if (op.includes('write') || op.includes('写入')) return 'info'
  return 'neutral'
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
          <div class="flex items-center gap-2">
            <h2 class="text-xl font-bold text-slate-100">
              {{ chip?.model || '芯片详情' }}
            </h2>
            <UBadge
              v-if="chip"
              :color="chip.chip_type === 'flash' ? 'cyan' : 'purple'"
              variant="subtle"
              size="xs"
            >
              {{ chip.chip_type === 'flash' ? 'NOR Flash' : 'MCU' }}
            </UBadge>
          </div>
          <p v-if="chip" class="mt-1 font-mono text-xs text-slate-500">
            ID: {{ chip.id }} · UID: {{ truncateUid(chip.uid, 20) }}
          </p>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-if="chip"
          icon="i-lucide-pen-line"
          color="neutral"
          variant="outline"
          size="sm"
          @click="noteText = chip.note || ''; showNoteModal = true"
        >
          改备注
        </UButton>
        <UButton
          v-if="chip?.chip_type === 'flash'"
          icon="i-lucide-lock"
          color="warning"
          variant="outline"
          size="sm"
          @click="lockForm.sec1 = chip.sec1_locked === 1; lockForm.sec2 = chip.sec2_locked === 1; lockForm.sec3 = chip.sec3_locked === 1; showLockModal = true"
        >
          锁定 OTP
        </UButton>
        <UButton
          v-if="chip?.chip_type === 'flash'"
          icon="i-lucide-upload"
          color="info"
          variant="outline"
          size="sm"
          @click="showWriteModal = true"
        >
          写入 Flash
        </UButton>
        <UButton
          v-if="chip"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          size="sm"
          :loading="pending"
          @click="refresh()"
        >
          刷新
        </UButton>
        <UButton
          v-if="chip"
          icon="i-lucide-trash-2"
          color="error"
          variant="outline"
          size="sm"
          @click="showDeleteModal = true"
        >
          销毁
        </UButton>
      </div>
    </div>

    <!-- 加载中 -->
    <div v-if="pending" class="space-y-4">
      <div class="h-32 animate-pulse rounded-lg bg-white/5" />
      <div class="grid grid-cols-3 gap-4">
        <div v-for="i in 3" :key="i" class="h-48 animate-pulse rounded-lg bg-white/5" />
      </div>
    </div>

    <!-- 错误 / 404 -->
    <div v-else-if="error || !chip" class="rounded-lg bg-[#1e1e3a] p-12 text-center ring-1 ring-white/5">
      <UIcon name="i-lucide-alert-octagon" class="mx-auto h-12 w-12 text-red-400" />
      <h3 class="mt-4 text-lg font-semibold text-slate-200">芯片不存在</h3>
      <p class="mt-1 text-sm text-slate-500">
        {{ error?.message || '未找到该芯片记录' }}
      </p>
      <UButton to="/chips" icon="i-lucide-list" color="primary" variant="outline" size="sm" class="mt-4">
        返回列表
      </UButton>
    </div>

    <template v-else>
      <!-- 基本信息 -->
      <div class="mb-6 rounded-lg bg-[#1e1e3a] ring-1 ring-white/5">
        <div class="flex items-center gap-2 border-b border-white/5 px-5 py-4">
          <UIcon name="i-lucide-info" class="h-5 w-5 text-cyan-400" />
          <h3 class="text-sm font-semibold text-slate-200">基本信息</h3>
        </div>
        <div class="grid grid-cols-2 gap-x-6 gap-y-4 p-5 md:grid-cols-3">
          <div>
            <dt class="text-xs text-slate-500">型号</dt>
            <dd class="mt-1 font-medium text-slate-200">{{ chip.model }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">芯片类型</dt>
            <dd class="mt-1">
              <UBadge
                :color="chip.chip_type === 'flash' ? 'cyan' : 'purple'"
                variant="subtle"
                size="xs"
              >
                {{ chip.chip_type === 'flash' ? 'NOR Flash' : 'MCU' }}
              </UBadge>
            </dd>
          </div>
          <div v-if="chip.chip_type === 'flash'">
            <dt class="text-xs text-slate-500">JEDEC ID</dt>
            <dd class="mt-1 font-mono text-cyan-400">{{ chip.jedec_id }}</dd>
          </div>
          <div v-if="chip.chip_type === 'flash'">
            <dt class="text-xs text-slate-500">容量</dt>
            <dd class="mt-1 text-slate-300">{{ chip.capacity || '-' }}</dd>
          </div>
          <div v-if="chip.chip_type === 'mcu'">
            <dt class="text-xs text-slate-500">芯片 ID</dt>
            <dd class="mt-1 font-mono text-cyan-400">{{ chip.jedec_id }}</dd>
          </div>
          <div v-if="chip.chip_type === 'mcu'">
            <dt class="text-xs text-slate-500">UID 长度</dt>
            <dd class="mt-1 text-slate-300">{{ chip.uid_length }} 字节</dd>
          </div>
          <div class="md:col-span-2">
            <dt class="text-xs text-slate-500">UID ({{ chip.uid_length }} 字节)</dt>
            <dd class="mt-1 flex items-center gap-2">
              <span class="font-mono text-sm text-cyan-400 break-all">{{ formatUid(chip.uid) }}</span>
              <UButton
                :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
                color="neutral"
                variant="ghost"
                size="xs"
                @click="copyUid"
              >
                {{ copied ? '已复制' : '复制' }}
              </UButton>
            </dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">创建时间</dt>
            <dd class="mt-1 font-mono text-xs text-slate-400">{{ formatDate(chip.created_at) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">更新时间</dt>
            <dd class="mt-1 font-mono text-xs text-slate-400">{{ formatDate(chip.updated_at) }}</dd>
          </div>
          <div v-if="chip.chip_type === 'flash'" class="md:col-span-3">
            <dt class="text-xs text-slate-500">OTP 锁定状态</dt>
            <dd class="mt-1 flex flex-wrap gap-2">
              <SecBadge :locked="chip.sec1_locked === 1" name="SEC1" />
              <SecBadge :locked="chip.sec2_locked === 1" name="SEC2" />
              <SecBadge :locked="chip.sec3_locked === 1" name="SEC3" />
            </dd>
          </div>
          <div v-if="chip.note" class="md:col-span-3">
            <dt class="text-xs text-slate-500">备注</dt>
            <dd class="mt-1 rounded-md bg-white/5 p-3 text-sm text-slate-300">{{ chip.note }}</dd>
          </div>
        </div>
      </div>

      <!-- 操作历史 -->
      <div class="rounded-lg bg-[#1e1e3a] ring-1 ring-white/5">
        <div class="flex items-center gap-2 border-b border-white/5 px-5 py-4">
          <UIcon name="i-lucide-history" class="h-5 w-5 text-cyan-400" />
          <h3 class="text-sm font-semibold text-slate-200">操作历史</h3>
          <span v-if="logs?.length" class="ml-auto text-xs text-slate-500">
            {{ logs.length }} 条记录
          </span>
        </div>

        <div v-if="!logs?.length" class="px-5 py-10 text-center">
          <UIcon name="i-lucide-clock" class="mx-auto h-8 w-8 text-slate-600" />
          <p class="mt-2 text-sm text-slate-500">暂无操作记录</p>
        </div>

        <div v-else class="p-5">
          <div class="relative space-y-5 border-l border-white/10 pl-6">
            <div v-for="log in logs" :key="log.id" class="relative">
              <span
                class="absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-2 ring-[#1e1e3a]"
                :class="log.operation.includes('destroy') || log.operation.includes('销毁') ? 'bg-red-400' : 'bg-cyan-400'"
              />
              <div class="flex items-center gap-2">
                <UBadge
                  :color="operationColor(log.operation)"
                  variant="subtle"
                  size="xs"
                  class="font-mono"
                >
                  {{ log.operation }}
                </UBadge>
                <span class="font-mono text-xs text-slate-500">{{ formatDate(log.created_at) }}</span>
              </div>
              <p v-if="log.detail" class="mt-1 text-sm text-slate-400">{{ log.detail }}</p>
              <a
                v-if="log.file_path"
                :href="`/api/logs/${log.id}/download`"
                class="mt-1 inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 hover:underline"
              >
                <UIcon name="i-lucide-download" class="h-3 w-3" />
                {{ log.file_path.split(/[\\/]/).pop() }}
              </a>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 改备注对话框 -->
    <UModal v-model:open="showNoteModal" title="修改备注">
      <template #body>
        <div class="space-y-3">
          <UTextarea
            v-model="noteText"
            placeholder="输入备注内容..."
            :rows="4"
          />
          <div v-if="noteError" class="rounded-md bg-red-500/10 p-3 text-sm text-red-300 ring-1 ring-red-500/20">
            {{ noteError }}
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="savingNote" @click="showNoteModal = false">
            取消
          </UButton>
          <UButton color="primary" variant="solid" :loading="savingNote" @click="saveNote">
            保存
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 锁定 OTP 对话框 -->
    <UModal v-model:open="showLockModal" title="锁定 OTP（安全区域）">
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-slate-400">勾选要锁定的安全区域，取消勾选则解除锁定。</p>
          <div class="space-y-2">
            <UCheckbox v-model="lockForm.sec1" label="SEC1 锁定" />
            <UCheckbox v-model="lockForm.sec2" label="SEC2 锁定" />
            <UCheckbox v-model="lockForm.sec3" label="SEC3 锁定" />
          </div>
          <div v-if="lockError" class="rounded-md bg-red-500/10 p-3 text-sm text-red-300 ring-1 ring-red-500/20">
            {{ lockError }}
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="locking" @click="showLockModal = false">
            取消
          </UButton>
          <UButton color="warning" variant="solid" :loading="locking" @click="saveLock">
            确认锁定
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 写入 Flash 对话框 -->
    <UModal v-model:open="showWriteModal" title="写入 Flash">
      <template #body>
        <div class="space-y-4">
          <div>
            <label class="mb-1.5 block text-sm font-medium text-slate-300">目标地址</label>
            <UInput v-model="writeAddress" placeholder="0x00" class="font-mono" />
          </div>
          <div>
            <label class="mb-1.5 block text-sm font-medium text-slate-300">选择 bin 文件</label>
            <input
              type="file"
              accept=".bin"
              class="block w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 file:mr-3 file:rounded file:border-0 file:bg-cyan-500/20 file:px-2 file:py-1 file:text-xs file:text-cyan-300 hover:bg-white/10"
              @change="(e: any) => { writeFile = e.target.files?.[0] ?? null }"
            />
            <p v-if="writeFile" class="mt-2 text-xs text-cyan-400">
              已选择: {{ writeFile.name }} ({{ writeFile.size }} bytes)
            </p>
          </div>
          <div v-if="writeError" class="rounded-md bg-red-500/10 p-3 text-sm text-red-300 ring-1 ring-red-500/20">
            {{ writeError }}
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="writing" @click="showWriteModal = false">
            取消
          </UButton>
          <UButton color="info" variant="solid" :loading="writing" :disabled="!writeFile" @click="submitWrite">
            确认写入
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 销毁确认对话框 -->
    <UModal v-model:open="showDeleteModal" :title="`销毁 ${chip?.model || '芯片'}？`">
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-slate-300">
            此操作将永久删除该芯片档案及其所有操作历史，且不可恢复。
          </p>
          <div v-if="chip" class="rounded-md bg-white/5 p-3 font-mono text-xs text-slate-400">
            <div>型号：{{ chip.model }}</div>
            <div>JEDEC ID：{{ chip.jedec_id }}</div>
            <div>UID：{{ truncateUid(chip.uid, 20) }}</div>
          </div>
          <div v-if="deleteError" class="rounded-md bg-red-500/10 p-3 text-sm text-red-300 ring-1 ring-red-500/20">
            {{ deleteError }}
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="deleting" @click="showDeleteModal = false">
            取消
          </UButton>
          <UButton color="error" variant="solid" :loading="deleting" @click="confirmDelete">
            确认删除
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import type { Chip, OperationLog } from '~~/shared/types'

interface ChipDetail extends Chip {
  operation_logs: OperationLog[]
}

const route = useRoute()
const chipId = route.params.id as string

const { data: chip, pending, error, refresh } = await useFetch<ChipDetail>(`/api/chips/${chipId}`)

// ---- 原件照片（🧪 实验功能，可选，一颗一张；重扫后加版本参数防缓存）----
const { flags } = useLab()
const photoOpen = ref(false)
const photoVer = ref(Date.now())
const photoBig = ref(false)
const photoUrl = computed(() => chip.value?.photo ? `/api/chips/${chipId}/photo?v=${photoVer.value}` : '')
function onPhotoSaved() {
  photoVer.value = Date.now()
  refresh()
}
async function removePhoto() {
  if (!window.confirm('删除这张原件照片？')) return
  try {
    await $fetch(`/api/chips/${chipId}/photo`, { method: 'DELETE' })
    toast.add({ title: '原件照片已删除', color: 'success' })
    photoVer.value = Date.now()
    refresh()
  } catch (e: any) {
    toast.add({ title: '删除失败', description: e?.data?.statusMessage || e?.message, color: 'error' })
  }
}

// ---- Datasheet（规格书，按型号共享：同型号所有芯片自动关联同一份）----
interface DatasheetInfo {
  id: number
  model: string
  original_name: string | null
  size: number | null
  uploaded_at: string
  version: string | null
  current_ver: number | null
  aliases: string | null
}
const dsQuery = computed(() => ({ model: chip.value?.model ?? '' }))
const { data: datasheet, refresh: refreshDs } = await useFetch<DatasheetInfo | null>('/api/datasheets/check', {
  query: dsQuery,
  watch: [dsQuery],
})

const dsInput = ref<HTMLInputElement | null>(null)
const dsBusy = ref(false)
const dsError = ref<string | null>(null)
const dsVersion = ref('') // 上传时可选的版本号标注（如 v3.9）

// ---- 版本历史 ----
interface DsVersionRow {
  id: number
  version: string | null
  original_name: string | null
  size: number | null
  uploaded_at: string
  is_current: boolean
}
const showVerModal = ref(false)
const verList = ref<DsVersionRow[]>([])
const verLoading = ref(false)

function fmtSize(s: number | null | undefined): string {
  if (!s) return ''
  return s >= 1024 * 1024 ? `${(s / 1024 / 1024).toFixed(1)} MB` : `${Math.round(s / 1024)} KB`
}

const dsSizeLabel = computed(() => fmtSize(datasheet.value?.size))

// 适用型号规则（如 STC8H*, PY32F002A）：精确型号或前缀通配
const dsAliasList = computed(() =>
  String(datasheet.value?.aliases || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean),
)

const showDsAliasModal = ref(false)
const dsAliasText = ref('')
const dsAliasBusy = ref(false)
const dsAliasError = ref<string | null>(null)

function openDsAliasModal() {
  dsAliasText.value = String(datasheet.value?.aliases || '')
  dsAliasError.value = null
  showDsAliasModal.value = true
}

async function confirmDsAlias() {
  if (!datasheet.value) return
  dsAliasBusy.value = true
  dsAliasError.value = null
  try {
    await $fetch(`/api/datasheets/${datasheet.value.id}/aliases`, {
      method: 'POST',
      body: { aliases: dsAliasText.value },
    })
    showDsAliasModal.value = false
    await refreshDs()
  } catch (err: any) {
    dsAliasError.value = err?.statusMessage || err?.message || '保存失败'
  } finally {
    dsAliasBusy.value = false
  }
}

async function openVerModal() {
  if (!datasheet.value) return
  showVerModal.value = true
  verLoading.value = true
  try {
    verList.value = await $fetch<DsVersionRow[]>(`/api/datasheets/${datasheet.value.id}/versions`)
  } catch (err: any) {
    dsError.value = err?.statusMessage || err?.message || '获取版本历史失败'
  } finally {
    verLoading.value = false
  }
}

async function revertTo(verId: number) {
  if (!datasheet.value) return
  dsBusy.value = true
  dsError.value = null
  try {
    await $fetch(`/api/datasheets/${datasheet.value.id}/revert`, { method: 'POST', body: { verId } })
    showVerModal.value = false
    await refreshDs()
  } catch (err: any) {
    dsError.value = err?.statusMessage || err?.message || '回滚失败'
  } finally {
    dsBusy.value = false
  }
}

// ---- URL 导入（服务器直接抓厂商 DS 链接入库，免手动下载再上传）----
const showDsUrlModal = ref(false)
const dsUrl = ref('')
const dsUrlVersion = ref('')
const dsUrlBusy = ref(false)
const dsUrlError = ref<string | null>(null)

function openDsUrlModal() {
  dsUrl.value = ''
  dsUrlVersion.value = ''
  dsUrlError.value = null
  showDsUrlModal.value = true
}

async function confirmDsUrl() {
  if (!chip.value) return
  const url = dsUrl.value.trim()
  if (!url) {
    dsUrlError.value = '请填写 DS 链接'
    return
  }
  dsUrlBusy.value = true
  dsUrlError.value = null
  try {
    await $fetch('/api/datasheets/url', {
      method: 'POST',
      body: {
        model: chip.value.model,
        url,
        version: dsUrlVersion.value.trim() || undefined,
      },
    })
    showDsUrlModal.value = false
    await refreshDs()
  } catch (err: any) {
    dsUrlError.value = err?.statusMessage || err?.message || '导入失败'
  } finally {
    dsUrlBusy.value = false
  }
}

function dsPick() {
  dsInput.value?.click()
}

async function onDsFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许重选同一文件
  if (!file || !chip.value) return
  dsBusy.value = true
  dsError.value = null
  try {
    const fd = new FormData()
    fd.append('model', chip.value.model)
    fd.append('file', file)
    if (dsVersion.value.trim()) fd.append('version', dsVersion.value.trim())
    await $fetch('/api/datasheets', { method: 'POST', body: fd })
    dsVersion.value = ''
    await refreshDs()
  } catch (err: any) {
    dsError.value = err?.statusMessage || err?.message || '上传失败'
  } finally {
    dsBusy.value = false
  }
}

async function dsDelete() {
  if (!datasheet.value) return
  if (!window.confirm(`删除「${datasheet.value.model}」的 Datasheet？同型号所有芯片将失去关联`)) return
  dsBusy.value = true
  dsError.value = null
  try {
    await $fetch(`/api/datasheets/${datasheet.value.id}`, { method: 'DELETE' })
    await refreshDs()
  } catch (err: any) {
    dsError.value = err?.statusMessage || err?.message || '删除失败'
  } finally {
    dsBusy.value = false
  }
}

/** 查看 PDF = 用系统默认程序（本机为 Acrobat）直接打开；网页内嵌预览已弃（Edge PDFium 渲染大 DS 卡顿） */
async function dsOpenLocal(verId?: number) {
  if (!datasheet.value) return
  dsError.value = null
  try {
    const q = verId ? { ver: verId } : undefined
    await $fetch(`/api/datasheets/${datasheet.value.id}/open`, { method: 'POST', query: q })
  } catch (err: any) {
    dsError.value = err?.statusMessage || err?.message || '打开失败'
  }
}

const logs = computed(() => chip.value?.operation_logs ?? [])

// 芯片类型徽章文案与配色（flash / mcu / other）
// 「其他」已选二级分类时直接显示分类路径，不再显示「其他」
function chipTypeMeta(type?: string | null, category?: string | null) {
  if (type === 'mcu') return { label: 'MCU', color: 'special' as const }
  if (type === 'other') {
    return { label: category ? categoryPath(category) : '其他', color: 'neutral' as const }
  }
  return { label: 'NOR Flash', color: 'data' as const }
}

// 封装尺寸图（带尺寸标注的工程图，仅部分封装提供）
const pkgDrawing = computed(() => findPackage(chip.value?.package)?.drawing ?? null)

const copied = ref(false)
const showDeleteModal = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

// ---- 打印标签 ----
const showPrintModal = ref(false)
const printer = usePrinter()

onMounted(() => {
  // 页面加载时预初始化打印机
  printer.init()
})

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

// ---- 编辑档案 ----
const showEditModal = ref(false)
const editing = ref(false)
const editError = ref<string | null>(null)
const editForm = reactive<Record<string, any>>({})

// 品牌选项：内置 + 手动添加的品牌；编辑回显时当前值不在列表则前置兜底
const { data: brandList } = await useFetch<{ name: string }[]>('/api/brands')
const brandOptions = computed(() => {
  const names = (brandList.value ?? []).map(b => b.name)
  const cur = (editForm.vendor as string | undefined)?.trim()
  if (cur && !names.includes(cur)) names.unshift(cur)
  return names
})

// 封装选项：内置 + 手动添加的封装；编辑回显时当前值不在列表则前置兜底
const { data: packageList } = await useFetch<{ name: string }[]>('/api/packages')
const packageOptions = computed(() => {
  const names = (packageList.value ?? []).map(p => p.name)
  const cur = (editForm.package as string | undefined)?.trim()
  if (cur && !names.includes(cur)) names.unshift(cur)
  return names
})

// 芯片类型（两级，仅「其他」使用）
interface CategoryItem { id: number, name: string, parent_id: number | null, chip_count: number }
const { data: categoryList } = await useFetch<CategoryItem[]>('/api/chip-categories')
const categoryRoots = computed(() =>
  (categoryList.value ?? [])
    .filter(c => c.parent_id === null)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
)
const rootOptions = computed(() => categoryRoots.value.map(c => c.name))

const editRoot = ref('')
const categoryOptions = computed(() => {
  const root = categoryRoots.value.find(c => c.name === editRoot.value)
  if (!root) return []
  const names = (categoryList.value ?? [])
    .filter(c => c.parent_id === root.id)
    .map(c => c.name)
    .sort((a, b) => a.localeCompare(b, 'zh'))
  const cur = String(editForm.chip_category ?? '').trim()
  if (cur && !names.includes(cur)) names.unshift(cur)
  return names
})

// 二级分类 → “一级 / 二级”
const categoryById = computed(() => new Map((categoryList.value ?? []).map(c => [c.id, c])))
function categoryPath(name: string | null | undefined) {
  if (!name) return ''
  const leaf = (categoryList.value ?? []).find(c => c.name === name)
  if (!leaf) return name
  const parent = leaf.parent_id ? categoryById.value.get(leaf.parent_id) : null
  return parent ? `${parent.name} / ${leaf.name}` : leaf.name
}

watch(editRoot, () => {
  if (editForm.chip_category && !categoryOptions.value.includes(editForm.chip_category)) {
    editForm.chip_category = ''
  }
})

// 库位自动序号
let editSeqPromise: Promise<void> | null = null
async function tryEditAutoSeq() {
  if (!editForm.location_a?.trim() || !editForm.location_b?.trim() || editForm.location_c?.trim()) return
  if (editSeqPromise) return
  editSeqPromise = (async () => {
    try {
      const rows: any[] = await $fetch('/api/chips', {
        params: { location_a: editForm.location_a.trim(), location_b: editForm.location_b.trim() }
      })
      let maxN = 0
      for (const r of rows) {
        if (chip.value && r.id === chip.value.id) continue
        const n = parseInt(r.location_c, 10)
        if (!isNaN(n) && n > maxN) maxN = n
      }
      if (!editForm.location_c?.trim()) editForm.location_c = String(maxN + 1)
    } catch { /* 忽略 */ }
    editSeqPromise = null
  })()
}
watch(() => [editForm.location_a, editForm.location_b] as const, () => tryEditAutoSeq())

function openEditModal() {
  if (!chip.value) return
  const leaf = (categoryList.value ?? []).find(c => c.name === chip.value!.chip_category)
  editRoot.value = leaf?.parent_id
    ? categoryById.value.get(leaf.parent_id)?.name ?? ''
    : ''
  Object.assign(editForm, {
    vendor: chip.value.vendor ?? '',
    model: chip.value.model ?? '',
    chip_type: chip.value.chip_type,
    jedec_id: chip.value.jedec_id ?? '',
    uid_length: chip.value.uid_length ?? 8,
    capacity: chip.value.capacity ?? '',
    package: chip.value.package ?? '',
    chip_category: chip.value.chip_category ?? '',
    qty_per_bag: chip.value.qty_per_bag ?? 1,
    location_a: chip.value.location_a ?? '',
    location_b: chip.value.location_b ?? '',
    location_c: chip.value.location_c ?? '',
    note: chip.value.note ?? ''
  })
  editError.value = null
  showEditModal.value = true
}

async function confirmEdit() {
  if (!chip.value) return
  if (editForm.chip_type === 'other') {
    if (!editRoot.value) {
      editError.value = '请选择一级分类'
      return
    }
    if (!String(editForm.chip_category ?? '').trim()) {
      editError.value = '请选择二级分类'
      return
    }
  }
  editing.value = true
  editError.value = null
  try {
    const body: Record<string, any> = {
      vendor: editForm.vendor?.trim() || null,
      model: editForm.model?.trim(),
      chip_type: editForm.chip_type,
      jedec_id: editForm.jedec_id?.trim() || '',
      uid_length: Number(editForm.uid_length) || 8,
      capacity: editForm.capacity?.trim() || null,
      package: editForm.package?.trim() || null,
      chip_category: editForm.chip_type === 'other'
        ? String(editForm.chip_category ?? '').trim()
        : null,
      // 单包颗数：仅「其他」类型 + 无 UID 有效，服务端也会兜底
      qty_per_bag: editForm.chip_type === 'other' && (!String(editForm.uid ?? '').trim() || isNoUid(String(editForm.uid)))
        ? (Number(editForm.qty_per_bag) || 1)
        : 1,
      location_a: editForm.location_a?.trim() || null,
      location_b: editForm.location_b?.trim() || null,
      location_c: editForm.location_c?.trim() || null,
      note: editForm.note?.trim() || null,
    }
    await $fetch(`/api/chips/${chip.value.id}`, { method: 'PUT', body })
    showEditModal.value = false
    await refresh()
  } catch (err: any) {
    editError.value = err?.statusMessage || err?.message || '保存失败'
  } finally {
    editing.value = false
  }
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
            <h2 class="text-xl font-bold text-ink">
              {{ chip?.model || '芯片详情' }}
            </h2>
            <UBadge
              v-if="chip"
              :color="chipTypeMeta(chip.chip_type, chip.chip_category).color"
              variant="subtle"
              size="xs"
            >
              {{ chipTypeMeta(chip.chip_type, chip.chip_category).label }}
            </UBadge>
          </div>
          <p v-if="chip" class="mt-1 font-mono text-xs text-ink-tertiary">
            ID: {{ chip.id }} · UID: {{ truncateUid(chip.uid, 20) || '-' }}
          </p>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-if="chip"
          icon="i-lucide-pencil"
          color="neutral"
          variant="outline"
          size="sm"
          @click="openEditModal"
        >
          编辑档案
        </UButton>
        <UButton
          v-if="chip"
          icon="i-lucide-pen-line"
          color="neutral"
          variant="ghost"
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
          icon="i-lucide-printer"
          color="notice"
          variant="outline"
          size="sm"
          @click="showPrintModal = true"
        >
          打印标签
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
      <div class="h-32 animate-pulse rounded-lg bg-surface-muted" />
      <div class="grid grid-cols-3 gap-4">
        <div v-for="i in 3" :key="i" class="h-48 animate-pulse rounded-lg bg-surface-muted" />
      </div>
    </div>

    <!-- 错误 / 404 -->
    <div v-else-if="error || !chip" class="rounded-lg bg-surface-raised p-12 text-center ring-1 ring-line">
      <UIcon name="i-lucide-alert-octagon" class="mx-auto h-12 w-12 text-alert-400" />
      <h3 class="mt-4 text-lg font-semibold text-ink">芯片不存在</h3>
      <p class="mt-1 text-sm text-ink-tertiary">
        {{ error?.message || '未找到该芯片记录' }}
      </p>
      <UButton to="/chips" icon="i-lucide-list" color="primary" variant="outline" size="sm" class="mt-4">
        返回列表
      </UButton>
    </div>

    <template v-else>
      <!-- 基本信息 -->
      <div class="mb-6 rounded-lg bg-surface-raised ring-1 ring-line">
        <div class="flex items-center gap-2 border-b border-line px-5 py-4">
          <UIcon name="i-lucide-info" class="h-5 w-5 text-action" />
          <h3 class="text-sm font-semibold text-ink">基本信息</h3>
        </div>
        <div class="grid grid-cols-2 gap-x-6 gap-y-4 p-5 md:grid-cols-3">
          <div>
            <dt class="text-xs text-ink-tertiary">厂商</dt>
            <dd class="mt-1">
              <NuxtLink
                v-if="chip.vendor"
                :to="`/brands/${encodeURIComponent(normalizeVendor(chip.vendor))}`"
                class="inline-flex items-center gap-3 text-notice-400 hover:text-notice-300"
              >
                <BrandLogo :vendor="chip.vendor" size="lg" />
                <span class="text-base font-medium">{{ normalizeVendor(chip.vendor) }}</span>
              </NuxtLink>
              <span v-else class="text-ink-tertiary">-</span>
            </dd>
          </div>
          <div>
            <dt class="text-xs text-ink-tertiary">型号</dt>
            <dd class="mt-1 font-medium text-ink">{{ chip.model }}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-tertiary">芯片类型</dt>
            <dd class="mt-1 flex items-center gap-1.5">
              <UBadge
                :color="chipTypeMeta(chip.chip_type, chip.chip_category).color"
                variant="subtle"
                size="xs"
              >
                {{ chipTypeMeta(chip.chip_type, chip.chip_category).label }}
              </UBadge>
            </dd>
          </div>
          <div v-if="chip.chip_type === 'other' && (chip.qty_per_bag ?? 1) > 1">
            <dt class="text-xs text-ink-tertiary">单包颗数</dt>
            <dd class="mt-1 font-medium text-ink">{{ chip.qty_per_bag }} 颗 / 包</dd>
          </div>

          <div v-if="chip.package">
            <dt class="text-xs text-ink-tertiary">封装</dt>
            <dd class="mt-1">
              <NuxtLink
                :to="`/packages/${encodeURIComponent(normalizePackage(chip.package))}`"
                class="inline-flex items-center gap-3 text-region-400 hover:text-region-300"
              >
                <PackageImage :pkg="chip.package" size="lg" />
                <span class="text-base font-medium">{{ normalizePackage(chip.package) }}</span>
              </NuxtLink>
            </dd>
          </div>
          <div v-if="chip.location_a || chip.location_b || chip.location_c">
            <dt class="text-xs text-ink-tertiary">库位</dt>
            <dd class="mt-1 text-action">
              <template v-if="chip.location_a">{{ chip.location_a }}</template>
              <template v-if="chip.location_a && (chip.location_b || chip.location_c)">-</template>
              <template v-if="chip.location_b">{{ chip.location_b }}</template>
              <template v-if="chip.location_b && chip.location_c">-</template>
              <template v-if="chip.location_c">{{ chip.location_c }}</template>
            </dd>
          </div>
          <div v-if="flags.chipPhoto">
            <dt class="text-xs text-ink-tertiary">原件照片</dt>
            <dd class="mt-1 flex flex-wrap items-center gap-2">
              <template v-if="chip.photo">
                <button
                  type="button"
                  class="group relative inline-block"
                  title="点击放大"
                  @click="photoBig = true"
                >
                  <img
                    :src="photoUrl"
                    alt="芯片原件照片"
                    class="h-16 max-w-40 rounded-md border border-special-500/10 object-contain"
                  />
                </button>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="soft"
                  icon="i-lucide-scanner-line"
                  @click="photoOpen = true"
                >
                  重扫
                </UButton>
                <UButton
                  size="xs"
                  color="error"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  @click="removePhoto"
                >
                  删除
                </UButton>
              </template>
              <template v-else>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="soft"
                  icon="i-lucide-scanner-line"
                  @click="photoOpen = true"
                >
                  补扫
                </UButton>
                <span class="text-xs text-ink-tertiary">可选，芯片放扫描仪玻璃板丝印朝下</span>
              </template>
            </dd>
          </div>
          <div>
            <dt class="text-xs text-ink-tertiary">Datasheet</dt>
            <dd class="mt-1 flex flex-wrap items-center gap-2">
              <template v-if="datasheet">
                <UButton
                  size="xs"
                  color="info"
                  variant="outline"
                  icon="i-lucide-file-text"
                  :disabled="dsBusy"
                  @click="dsOpenLocal"
                >
                  查看 PDF（Acrobat）
                </UButton>
                <UBadge v-if="datasheet.version" color="info" variant="subtle" size="xs">
                  {{ datasheet.version }}
                </UBadge>
                <UBadge
                  v-for="rule in dsAliasList"
                  :key="rule"
                  color="special"
                  variant="subtle"
                  size="xs"
                  class="font-mono"
                >
                  {{ rule }}
                </UBadge>
                <span v-if="dsSizeLabel" class="text-xs text-ink-tertiary">{{ dsSizeLabel }}</span>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-crosshair"
                  @click="openDsAliasModal"
                >
                  适用型号
                </UButton>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-history"
                  :disabled="dsBusy"
                  @click="openVerModal"
                >
                  历史
                </UButton>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-upload"
                  :loading="dsBusy"
                  @click="dsPick"
                >
                  上传新版本
                </UButton>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-link"
                  @click="openDsUrlModal"
                >
                  URL 导入
                </UButton>
                <UButton
                  size="xs"
                  color="error"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  :disabled="dsBusy"
                  @click="dsDelete"
                >
                  删除
                </UButton>
              </template>
              <template v-else>
                <UInput
                  v-model="dsVersion"
                  size="xs"
                  placeholder="版本号（选填）"
                  class="w-28"
                />
                <UButton
                  size="xs"
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-upload"
                  :loading="dsBusy"
                  @click="dsPick"
                >
                  上传 DS
                </UButton>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-link"
                  @click="openDsUrlModal"
                >
                  URL 导入
                </UButton>
                <span class="text-xs text-ink-tertiary">PDF ≤ 50MB，同型号自动关联共享</span>
              </template>
              <input ref="dsInput" type="file" accept="application/pdf,.pdf" class="hidden" @change="onDsFile">
            </dd>
            <p v-if="dsError" class="mt-1 text-xs text-alert-400">{{ dsError }}</p>
          </div>
          <div v-if="chip.chip_type === 'flash'">
            <dt class="text-xs text-ink-tertiary">JEDEC ID</dt>
            <dd class="mt-1 font-mono text-action">{{ formatJedecId(chip.jedec_id) }}</dd>
          </div>
          <div v-if="chip.chip_type === 'flash'">
            <dt class="text-xs text-ink-tertiary">容量</dt>
            <dd class="mt-1 text-ink-secondary">{{ chip.capacity || '-' }}</dd>
          </div>
          <div v-if="chip.chip_type === 'mcu' && chip.jedec_id">
            <dt class="text-xs text-ink-tertiary">芯片 ID</dt>
            <dd class="mt-1 font-mono text-action">{{ formatJedecId(chip.jedec_id) }}</dd>
          </div>
          <div v-if="chip.chip_type === 'mcu'">
            <dt class="text-xs text-ink-tertiary">UID 长度</dt>
            <dd class="mt-1 text-ink-secondary">{{ chip.uid_length }} 字节</dd>
          </div>
          <div v-if="chip.uid || chip.chip_type !== 'other'" class="md:col-span-2">
            <dt class="text-xs text-ink-tertiary">{{ chip.uid ? `UID (${chip.uid_length} 字节)` : 'UID' }}</dt>
            <dd class="mt-1 flex items-center gap-2">
              <span class="font-mono text-sm text-action break-all">{{ chip.uid ? formatUid(chip.uid) : '/' }}</span>
              <UButton
                v-if="chip.uid"
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
            <dt class="text-xs text-ink-tertiary">创建时间</dt>
            <dd class="mt-1 font-mono text-xs text-ink-secondary">{{ formatDate(chip.created_at) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-tertiary">更新时间</dt>
            <dd class="mt-1 font-mono text-xs text-ink-secondary">{{ formatDate(chip.updated_at) }}</dd>
          </div>
          <div v-if="chip.chip_type === 'flash'" class="md:col-span-3">
            <dt class="text-xs text-ink-tertiary">OTP 锁定状态</dt>
            <dd class="mt-1 flex flex-wrap gap-2">
              <SecBadge :locked="chip.sec1_locked === 1" name="SEC1" />
              <SecBadge :locked="chip.sec2_locked === 1" name="SEC2" />
              <SecBadge :locked="chip.sec3_locked === 1" name="SEC3" />
            </dd>
          </div>
          <div v-if="chip.note" class="md:col-span-3">
            <dt class="text-xs text-ink-tertiary">备注</dt>
            <dd class="mt-1 rounded-md bg-surface-muted p-3 text-sm text-ink-secondary">{{ chip.note }}</dd>
          </div>
        </div>
      </div>

      <!-- 封装尺寸图（带标注的工程图，仅部分封装提供） -->
      <div v-if="pkgDrawing" class="mb-6 rounded-lg bg-surface-raised ring-1 ring-line">
        <div class="flex items-center gap-2 border-b border-line px-5 py-4">
          <UIcon name="i-lucide-ruler" class="h-5 w-5 text-region-400" />
          <h3 class="text-sm font-semibold text-ink">封装尺寸图</h3>
          <span class="ml-auto text-xs text-ink-tertiary">单位 mm · 依据规格书</span>
        </div>
        <div class="flex justify-center p-5">
          <img
            :src="pkgDrawing"
            :alt="`${normalizePackage(chip.package)} 尺寸图`"
            class="w-full max-w-[720px] object-contain"
            loading="lazy"
          >
        </div>
      </div>

      <!-- 操作历史 -->
      <div class="rounded-lg bg-surface-raised ring-1 ring-line">
        <div class="flex items-center gap-2 border-b border-line px-5 py-4">
          <UIcon name="i-lucide-history" class="h-5 w-5 text-action" />
          <h3 class="text-sm font-semibold text-ink">操作历史</h3>
          <span v-if="logs?.length" class="ml-auto text-xs text-ink-tertiary">
            {{ logs.length }} 条记录
          </span>
        </div>

        <div v-if="!logs?.length" class="px-5 py-10 text-center">
          <UIcon name="i-lucide-clock" class="mx-auto h-8 w-8 text-ink-tertiary" />
          <p class="mt-2 text-sm text-ink-tertiary">暂无操作记录</p>
        </div>

        <div v-else class="p-5">
          <div class="relative space-y-5 border-l border-line pl-6">
            <div v-for="log in logs" :key="log.id" class="relative">
              <span
                class="absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-2 ring-line"
                :class="log.operation.includes('destroy') || log.operation.includes('销毁') ? 'bg-alert-400' : 'bg-data-400'"
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
                <span class="font-mono text-xs text-ink-tertiary">{{ formatDate(log.created_at) }}</span>
              </div>
              <p v-if="log.detail" class="mt-1 text-sm text-ink-secondary">{{ log.detail }}</p>
              <a
                v-if="log.file_path"
                :href="`/api/logs/${log.id}/download`"
                class="mt-1 inline-flex items-center gap-1 text-xs text-action hover:text-data-300 hover:underline"
              >
                <UIcon name="i-lucide-download" class="h-3 w-3" />
                {{ log.file_path.split(/[\\/]/).pop() }}
              </a>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 编辑档案对话框 -->
    <UModal v-model:open="showEditModal" title="编辑芯片档案">
      <template #body>
        <div class="space-y-3">
          <div v-if="editError" class="rounded-md bg-alert-500/10 p-3 text-sm text-alert-300 ring-1 ring-alert-500/20">
            {{ editError }}
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs text-ink-tertiary">厂商</label>
              <USelect v-model="editForm.vendor" :items="brandOptions" placeholder="选择品牌" class="w-full" />
            </div>
            <div>
              <label class="mb-1 block text-xs text-ink-tertiary">型号</label>
              <UInput v-model="editForm.model" class="w-full" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs text-ink-tertiary">类型</label>
              <USelect
                v-model="editForm.chip_type"
                :items="[
                  { label: 'NOR Flash', value: 'flash' },
                  { label: 'MCU 单片机', value: 'mcu' },
                  { label: '其他', value: 'other' }
                ]"
                class="w-full"
              />
            </div>
            <div v-if="editForm.chip_type !== 'other'">
              <label class="mb-1 block text-xs text-ink-tertiary">容量</label>
              <UInput v-model="editForm.capacity" placeholder="如: 16Mbit / 2MB" class="w-full" />
            </div>
            <div v-if="editForm.chip_type === 'other'">
              <label class="mb-1 block text-xs text-ink-tertiary">一级分类 *</label>
              <USelect v-model="editRoot" :items="rootOptions" placeholder="选择一级分类" class="w-full" />
            </div>
            <div v-if="editForm.chip_type === 'other'">
              <label class="mb-1 block text-xs text-ink-tertiary">二级分类 *</label>
              <USelect
                v-model="editForm.chip_category"
                :items="categoryOptions"
                :disabled="!editRoot"
                placeholder="选择二级分类"
                class="w-full"
              />
            </div>
            <div v-if="editForm.chip_type === 'other'">
              <label class="mb-1 block text-xs text-ink-tertiary">
                单包颗数
                <span v-if="String(editForm.uid ?? '').trim() && !isNoUid(String(editForm.uid))" class="text-ink-tertiary">（有 UID，锁定 1）</span>
              </label>
              <UInput
                v-model.number="editForm.qty_per_bag"
                type="number"
                min="1"
                step="1"
                :disabled="!!String(editForm.uid ?? '').trim() && !isNoUid(String(editForm.uid))"
                placeholder="1"
                class="w-full"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-ink-tertiary">封装</label>
              <USelect v-model="editForm.package" :items="packageOptions" placeholder="选择封装" class="w-full" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div v-if="editForm.chip_type !== 'other'">
              <label class="mb-1 block text-xs text-ink-tertiary">JEDEC ID</label>
              <UInput v-model="editForm.jedec_id" class="w-full font-mono" />
            </div>
            <div>
              <label class="mb-1 block text-xs text-ink-tertiary">UID 长度 (字节)</label>
              <UInput v-model.number="editForm.uid_length" type="number" class="w-full" />
            </div>
          </div>

          <div>
            <label class="mb-1 block text-xs text-ink-tertiary">库位</label>
            <div class="grid grid-cols-3 gap-2">
              <UInput v-model="editForm.location_a" placeholder="大箱" class="w-full" />
              <UInput v-model="editForm.location_b" placeholder="小箱" class="w-full" />
              <UInput v-model="editForm.location_c" placeholder="序号" class="w-full" />
            </div>
          </div>

          <div>
            <label class="mb-1 block text-xs text-ink-tertiary">备注</label>
            <UTextarea v-model="editForm.note" :rows="3" class="w-full" />
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="editing" @click="showEditModal = false">
            取消
          </UButton>
          <UButton color="primary" variant="solid" :loading="editing" @click="confirmEdit">
            保存
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 改备注对话框 -->
    <UModal v-model:open="showNoteModal" title="修改备注">
      <template #body>
        <div class="space-y-3">
          <UTextarea
            v-model="noteText"
            placeholder="输入备注内容..."
            :rows="4"
          />
          <div v-if="noteError" class="rounded-md bg-alert-500/10 p-3 text-sm text-alert-300 ring-1 ring-alert-500/20">
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
          <p class="text-sm text-ink-secondary">勾选要锁定的安全区域，取消勾选则解除锁定。</p>
          <div class="space-y-2">
            <UCheckbox v-model="lockForm.sec1" label="SEC1 锁定" />
            <UCheckbox v-model="lockForm.sec2" label="SEC2 锁定" />
            <UCheckbox v-model="lockForm.sec3" label="SEC3 锁定" />
          </div>
          <div v-if="lockError" class="rounded-md bg-alert-500/10 p-3 text-sm text-alert-300 ring-1 ring-alert-500/20">
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
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">目标地址</label>
            <UInput v-model="writeAddress" placeholder="0x00" class="font-mono" />
          </div>
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">选择 bin 文件</label>
            <input
              type="file"
              accept=".bin"
              class="block w-full rounded-md border border-line bg-surface-muted px-3 py-2 text-sm text-ink-secondary file:mr-3 file:rounded file:border-0 file:bg-data-500/20 file:px-2 file:py-1 file:text-xs file:text-data-300 hover:bg-surface-muted"
              @change="(e: any) => { writeFile = e.target.files?.[0] ?? null }"
            />
            <p v-if="writeFile" class="mt-2 text-xs text-action">
              已选择: {{ writeFile.name }} ({{ writeFile.size }} bytes)
            </p>
          </div>
          <div v-if="writeError" class="rounded-md bg-alert-500/10 p-3 text-sm text-alert-300 ring-1 ring-alert-500/20">
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
          <p class="text-sm text-ink-secondary">
            此操作将永久删除该芯片档案及其所有操作历史，且不可恢复。
          </p>
          <div v-if="chip" class="rounded-md bg-surface-muted p-3 font-mono text-xs text-ink-secondary">
            <div>型号：{{ chip.model }}</div>
            <div>类型：{{ chipTypeMeta(chip.chip_type).label }}</div>
            <div>JEDEC ID：{{ formatJedecId(chip.jedec_id) || '-' }}</div>
            <div>UID：{{ truncateUid(chip.uid, 20) || '-' }}</div>
          </div>
          <div v-if="deleteError" class="rounded-md bg-alert-500/10 p-3 text-sm text-alert-300 ring-1 ring-alert-500/20">
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

    <!-- 打印标签对话框 -->
    <UModal v-model:open="showVerModal" title="Datasheet 版本历史">
      <template #body>
        <div class="space-y-2">
          <p v-if="verLoading" class="text-sm text-ink-tertiary">加载中…</p>
          <p v-else-if="!verList.length" class="text-sm text-ink-tertiary">无历史版本</p>
          <div
            v-for="v in verList"
            :key="v.id"
            class="flex items-center justify-between rounded-md px-3 py-2 ring-1 ring-line"
          >
            <div>
              <div class="flex items-center gap-2 text-sm text-ink">
                <span class="font-medium">{{ v.version || '（未标版本）' }}</span>
                <UBadge v-if="v.is_current" color="info" variant="subtle" size="xs">当前</UBadge>
              </div>
              <p class="mt-0.5 text-xs text-ink-tertiary">
                {{ v.original_name }}<template v-if="fmtSize(v.size)"> · {{ fmtSize(v.size) }}</template> · {{ v.uploaded_at }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-file-text"
                :disabled="dsBusy"
                @click="dsOpenLocal(v.id)"
              >
                打开
              </UButton>
              <UButton
                v-if="!v.is_current"
                size="xs"
                variant="soft"
                :disabled="dsBusy"
                @click="revertTo(v.id)"
              >
                设为当前
              </UButton>
            </div>
          </div>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="showDsUrlModal" title="从 URL 导入 Datasheet">
      <template #body>
        <div class="space-y-3">
          <p class="text-xs text-ink-tertiary">
            服务器直接抓取链接（自动跟随 302 跳转），校验 PDF 后存为新版本——免手动下载再上传。链接需直指 PDF 文件。
          </p>
          <UInput
            v-model="dsUrl"
            placeholder="https://www.wch.cn/downloads/xxx-zip.html 的直链 / 厂商官网 PDF 链接"
            class="w-full font-mono"
          />
          <UInput
            v-model="dsUrlVersion"
            placeholder="版本号（选填，如 V3.9）"
            class="w-40"
          />
          <p v-if="dsUrlError" class="text-xs text-alert-400">{{ dsUrlError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="showDsUrlModal = false">
            取消
          </UButton>
          <UButton
            color="info"
            icon="i-lucide-download"
            :loading="dsUrlBusy"
            @click="confirmDsUrl"
          >
            抓取入库
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="showDsAliasModal" title="DS 适用型号规则">
      <template #body>
        <div class="space-y-3">
          <p class="text-xs text-ink-tertiary">
            一份 DS 覆盖多个型号时在此登记：每条规则为「精确型号」或「前缀通配」（尾缀 *），
            逗号分隔。例：STC8H*, PY32F002A。命中规则的型号自动关联本 DS（列表亮 DS 徽章、录入免上传）。留空 = 仅当前型号。
          </p>
          <UInput
            v-model="dsAliasText"
            placeholder="STC8H*, PY32F002A"
            class="w-full font-mono"
          />
          <p v-if="dsAliasError" class="text-xs text-alert-400">{{ dsAliasError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="showDsAliasModal = false">
            取消
          </UButton>
          <UButton color="info" icon="i-lucide-check" :loading="dsAliasBusy" @click="confirmDsAlias">
            保存
          </UButton>
        </div>
      </template>
    </UModal>

    <PrintLabelModal v-model:open="showPrintModal" mode="chip" :chip="chip" />

    <!-- 原件照片：补扫/重扫 -->
    <ChipPhotoScan :key="photoVer" v-model:open="photoOpen" :chip-id="Number(chipId)" @saved="onPhotoSaved" />

    <!-- 原件照片放大查看 -->
    <UModal v-model:open="photoBig" title="芯片原件照片">
      <template #body>
        <img
          v-if="photoUrl"
          :src="photoUrl"
          alt="芯片原件照片"
          class="max-h-[70vh] w-full rounded-md object-contain"
        />
      </template>
    </UModal>
  </div>
</template>

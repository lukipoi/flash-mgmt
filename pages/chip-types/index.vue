<script setup lang="ts">
/**
 * 芯片类型列表（两级分类，参照立创商城目录）
 * 一级分类下挂二级分类；「其他」类型芯片只能选择二级分类
 */
interface CategoryItem {
  id: number
  name: string
  parent_id: number | null
  chip_count: number
  created_at: string
}

definePageMeta({
  title: '芯片类型列表'
})

const { data: categories, pending, error, refresh } = await useFetch<CategoryItem[]>('/api/chip-categories')
const toast = useToast()

const roots = computed(() =>
  (categories.value ?? [])
    .filter(c => c.parent_id === null)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
)

function childrenOf(id: number) {
  return (categories.value ?? [])
    .filter(c => c.parent_id === id)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

/** 一级分类的芯片总数 = 其下所有二级分类之和 */
function totalCount(root: CategoryItem) {
  return root.chip_count + childrenOf(root.id).reduce((sum, c) => sum + c.chip_count, 0)
}

// ---- 搜索与展开 ----
const search = ref('')
const q = computed(() => search.value.trim().toLowerCase())

/** 搜索时：一级命中则显示其全部子类；否则只显示命中的子类 */
function childrenFor(root: CategoryItem) {
  const list = childrenOf(root.id)
  if (!q.value || root.name.toLowerCase().includes(q.value)) return list
  return list.filter(c => c.name.toLowerCase().includes(q.value))
}

const visibleRoots = computed(() => {
  if (!q.value) return roots.value
  return roots.value.filter(r =>
    r.name.toLowerCase().includes(q.value) || childrenFor(r).length > 0
  )
})

// 打开页面时一级分类默认折叠，只记录用户主动展开的项
const expanded = ref<Set<number>>(new Set())
function toggle(id: number) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}
function isExpanded(root: CategoryItem) {
  return !!q.value || expanded.value.has(root.id)
}

// ---- 新增 / 编辑 ----
const showFormModal = ref(false)
const editingId = ref<number | null>(null)
const formParent = ref<CategoryItem | null>(null)
const nameInput = ref('')
const saving = ref(false)
const formError = ref<string | null>(null)

const formTitle = computed(() => {
  if (editingId.value !== null) return '编辑分类'
  return formParent.value ? '新增二级分类' : '新增一级分类'
})

function openAddRoot() {
  editingId.value = null
  formParent.value = null
  nameInput.value = ''
  formError.value = null
  showFormModal.value = true
}

function openAddChild(parent: CategoryItem) {
  editingId.value = null
  formParent.value = parent
  nameInput.value = ''
  formError.value = null
  showFormModal.value = true
}

function openEdit(item: CategoryItem, parent: CategoryItem | null) {
  editingId.value = item.id
  formParent.value = parent
  nameInput.value = item.name
  formError.value = null
  showFormModal.value = true
}

function closeFormModal() {
  showFormModal.value = false
}

async function save() {
  const name = nameInput.value.trim()
  if (!name) {
    formError.value = '分类名称必填'
    return
  }
  saving.value = true
  formError.value = null
  try {
    if (editingId.value === null) {
      await $fetch('/api/chip-categories', {
        method: 'POST',
        body: { name, parent_id: formParent.value?.id ?? null }
      })
    } else {
      await $fetch(`/api/chip-categories/${editingId.value}`, { method: 'PUT', body: { name } })
    }
    showFormModal.value = false
    await refresh()
    toast.add({ title: editingId.value === null ? '已新增分类' : '已保存', color: 'success' })
  } catch (e: any) {
    formError.value = e?.statusMessage || e?.data?.statusMessage || e?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

// ---- 删除 ----
const showDeleteModal = ref(false)
const deletingItem = ref<CategoryItem | null>(null)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

const deletingChildCount = computed(() =>
  deletingItem.value?.parent_id === null ? childrenOf(deletingItem.value.id).length : 0
)

function openDelete(item: CategoryItem) {
  deletingItem.value = item
  deleteError.value = null
  showDeleteModal.value = true
}

function closeDeleteModal() {
  showDeleteModal.value = false
}

async function confirmDelete() {
  if (!deletingItem.value) return
  deleting.value = true
  deleteError.value = null
  try {
    await $fetch(`/api/chip-categories/${deletingItem.value.id}`, { method: 'DELETE' })
    showDeleteModal.value = false
    await refresh()
    toast.add({ title: '已删除分类', color: 'success' })
  } catch (e: any) {
    deleteError.value = e?.statusMessage || e?.data?.statusMessage || e?.message || '删除失败'
  } finally {
    deleting.value = false
  }
}

// ---- 导入立创分类 ----
const seeding = ref(false)
async function importLcsc() {
  seeding.value = true
  try {
    const res = await $fetch<{ roots: number, children: number }>('/api/chip-categories/seed', { method: 'POST' })
    await refresh()
    toast.add({
      title: '已导入立创分类',
      description: `新增一级 ${res.roots} 个、二级 ${res.children} 个`,
      color: 'success'
    })
  } catch (e: any) {
    toast.add({
      title: '导入失败',
      description: e?.statusMessage || e?.message || '请稍后重试',
      color: 'error'
    })
  } finally {
    seeding.value = false
  }
}
</script>

<template>
  <div class="min-h-full p-6">
    <!-- 页头 -->
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-xl font-bold text-ink">芯片类型列表</h2>
        <p class="mt-1 text-sm text-ink-tertiary">
          两级分类（参照立创商城）；「其他」类型芯片只能选择二级分类
        </p>
      </div>
      <div class="flex items-center gap-2">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="搜索分类"
          class="w-48"
          size="sm"
        />
        <UButton
          icon="i-lucide-download"
          color="neutral"
          variant="outline"
          size="sm"
          :loading="seeding"
          @click="importLcsc"
        >
          导入立创分类
        </UButton>
        <UButton
          icon="i-lucide-plus"
          color="primary"
          variant="solid"
          size="sm"
          @click="openAddRoot"
        >
          新增一级
        </UButton>
      </div>
    </div>

    <!-- 错误提示 -->
    <div
      v-if="error"
      class="mb-4 flex items-center gap-3 rounded-lg bg-alert-500/10 p-4 ring-1 ring-alert-500/20"
    >
      <UIcon name="i-lucide-alert-circle" class="h-5 w-5 text-alert-400" />
      <span class="text-sm text-alert-300">加载失败: {{ error?.message }}</span>
    </div>

    <!-- 加载中 -->
    <div v-if="pending" class="space-y-3">
      <div v-for="i in 6" :key="i" class="h-14 animate-pulse rounded-lg bg-surface-muted" />
    </div>

    <div
      v-else-if="!visibleRoots.length"
      class="rounded-lg bg-surface-raised px-5 py-14 text-center ring-1 ring-line"
    >
      <UIcon name="i-lucide-tags" class="mx-auto h-10 w-10 text-ink-tertiary" />
      <p class="mt-3 text-sm text-ink-tertiary">
        {{ search ? '没有匹配的分类' : '暂无芯片类型，可导入立创分类或手动新增' }}
      </p>
      <UButton
        v-if="!search && !roots.length"
        class="mt-4"
        icon="i-lucide-download"
        color="primary"
        variant="solid"
        size="sm"
        :loading="seeding"
        @click="importLcsc"
      >
        导入立创分类
      </UButton>
    </div>

    <!-- 两级分类树 -->
    <div v-else class="space-y-3">
      <div
        v-for="root in visibleRoots"
        :key="root.id"
        class="ct-card overflow-hidden rounded-lg bg-surface-raised ring-1 ring-line"
        :class="{ 'is-open': isExpanded(root) }"
      >
        <!-- 一级分类 -->
        <div class="flex items-center gap-2 px-3 py-3">
          <button
            type="button"
            class="ct-caret-icon flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-tertiary hover:bg-surface-muted hover:text-ink-secondary"
            :title="isExpanded(root) ? '收起' : '展开'"
            :aria-expanded="isExpanded(root)"
            @click="toggle(root.id)"
          >
            <!-- 单个 chevron + CSS rotate(90deg)：展开 / 收起都是同一条过渡，不做字形切换 -->
            <UIcon name="i-lucide-chevron-right" class="h-4 w-4" />
          </button>
          <UIcon name="i-lucide-folder" class="h-4 w-4 shrink-0 text-action" />
          <span class="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{{ root.name }}</span>
          <span class="shrink-0 text-xs text-ink-tertiary">
            {{ childrenOf(root.id).length }} 个子类 · {{ totalCount(root) }} 颗
          </span>
          <div class="flex shrink-0 items-center gap-1">
            <UButton
              icon="i-lucide-plus"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="openAddChild(root)"
            >
              二级
            </UButton>
            <UButton
              icon="i-lucide-pencil"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="openEdit(root, null)"
            />
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              @click="openDelete(root)"
            />
          </div>
        </div>

        <!-- 二级分类：常驻 DOM + is-open，展开 / 收起交给 utilities.css 的 G1。
             border-t 放进 .ct-pad，0fr 时一起被裁掉，折叠态不留孤线；
             inert 挡掉折叠态的键盘焦点，避免 Tab 进看不见的按钮。 -->
        <div
          class="ct-children"
          :aria-hidden="!isExpanded(root)"
          :inert="!isExpanded(root) || undefined"
        >
          <div class="ct-children-inner">
            <span class="ct-guide" aria-hidden="true"></span>
            <div class="ct-pad">
              <div
                v-for="child in childrenFor(root)"
                :key="child.id"
                class="flex items-center gap-2 py-2 pl-11 pr-3 hover:bg-surface-muted/10"
              >
                <UIcon name="i-lucide-corner-down-right" class="h-3.5 w-3.5 shrink-0 text-ink-tertiary" />
                <span class="min-w-0 flex-1 truncate text-sm text-ink-secondary">{{ child.name }}</span>
                <span class="shrink-0 text-xs text-ink-tertiary">{{ child.chip_count }} 颗</span>
                <div class="flex shrink-0 items-center gap-1">
                  <UButton
                    icon="i-lucide-pencil"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    @click="openEdit(child, root)"
                  />
                  <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    size="xs"
                    @click="openDelete(child)"
                  />
                </div>
              </div>
              <p v-if="!childrenFor(root).length" class="py-2 pl-11 text-xs text-ink-tertiary">
                暂无二级分类，点右侧「二级」新增
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 新增 / 编辑弹窗 -->
    <UModal v-model:open="showFormModal" :title="formTitle">
      <template #body>
        <div class="space-y-3">
          <div v-if="formError" class="rounded-md bg-alert-500/10 p-3 text-sm text-alert-300 ring-1 ring-alert-500/20">
            {{ formError }}
          </div>
          <div v-if="formParent" class="rounded-md bg-surface-muted px-3 py-2 text-xs text-ink-secondary">
            上级分类：<span class="text-ink">{{ formParent.name }}</span>
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-tertiary">分类名称</label>
            <UInput
              v-model="nameInput"
              :placeholder="formParent ? '如: NOR FLASH' : '如: 存储器 / 电源管理'"
              class="w-full"
              @keyup.enter="save"
            />
          </div>
          <p v-if="editingId !== null" class="text-xs text-ink-tertiary">
            改名后，已使用该分类的芯片档案会同步更新。
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="saving" @click="closeFormModal">
            取消
          </UButton>
          <UButton color="primary" variant="solid" :loading="saving" @click="save">
            保存
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 删除确认 -->
    <UModal v-model:open="showDeleteModal" title="删除分类">
      <template #body>
        <div class="space-y-3">
          <div v-if="deleteError" class="rounded-md bg-alert-500/10 p-3 text-sm text-alert-300 ring-1 ring-alert-500/20">
            {{ deleteError }}
          </div>
          <p class="text-sm text-ink-secondary">
            确认删除「<span class="text-action">{{ deletingItem?.name }}</span>」？
          </p>
          <p v-if="deletingChildCount" class="text-xs text-notice-400">
            该一级分类下还有 {{ deletingChildCount }} 个二级分类，需先删除子类。
          </p>
          <p v-if="deletingItem?.chip_count" class="text-xs text-notice-400">
            该分类下还有 {{ deletingItem.chip_count }} 颗芯片，删除会被拒绝。
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="deleting" @click="closeDeleteModal">
            取消
          </UButton>
          <UButton color="error" variant="solid" :loading="deleting" @click="confirmDelete">
            删除
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

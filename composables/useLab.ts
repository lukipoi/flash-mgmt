/**
 * 实验性功能开关（🧪 Lab Features）
 *
 * 全局单例 ref + localStorage 持久化（key: flash-mgmt:lab）。
 * 各页面/组件直接引用同一份状态，面板开关即时生效。
 * 开关面板：components/LabFeaturesPanel.vue（identify.vue / chips/new.vue 底部）。
 */
export interface LabFlags {
  /** eSCL 快扫：网络直连打印机，整面 + 低 DPI（100dpi 实测约 4.1s，码任意位置） */
  esclStream: boolean
  /** HK32 读取（实验）：读取器列表追加「HK32 系列（实验）」通道 */
  hk32Read: boolean
  /** 芯片原件照片（实验）：录入/详情页扫芯片实物照，一颗一张，非强制 */
  chipPhoto: boolean
}

const LAB_KEY = 'flash-mgmt:lab'
const _flags = ref<LabFlags>({ esclStream: false, hk32Read: false, chipPhoto: false })
let _loaded = false

export function useLab() {
  if (!_loaded && typeof window !== 'undefined') {
    _loaded = true
    try {
      Object.assign(_flags.value, JSON.parse(localStorage.getItem(LAB_KEY) || '{}'))
    } catch { /* 坏数据按默认 */ }
    watch(_flags, (v) => {
      try { localStorage.setItem(LAB_KEY, JSON.stringify(v)) } catch { /* 忽略 */ }
    }, { deep: true })
  }
  return { flags: _flags }
}

/** eSCL 扫描默认打印机（逆向实测 HP DeskJet，Webscan/eSCL 无认证直连）。 */
export const LAB_DEFAULT_ESCL = 'http://192.168.1.208/eSCL'

/** eSCL 快扫 DPI（真机：150dpi 清晰度用户不过关，200dpi 整图命中 ~6.5-7.1s；300dpi 7.5s 收益小不再加）。 */
export const LAB_ESCL_DPI = 200

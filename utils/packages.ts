/**
 * 封装名标准化 + 封装图映射（与 brands.ts 同构）
 * - normalizePackage: 大小写/空格/连字符混写 → 统一规范名（如 "sop8"/"SOIC-8" → "SOP-8"）
 * - packageImageUrl:  规范名 → /packages/ 下封装图路径
 * 封装图同样利用 alpha 透明底直接展示；内置封装无图时用首字母徽章兜底，
 * 用户可在封装列表页给内置封装补图（上传后存 packages 表覆盖内置条目）
 */

export interface PackageMeta {
  /** 规范封装名（存储/显示统一用它） */
  name: string
  /** 封装图路径（public/ 下，小缩略图，不带尺寸标注），无图不设置 */
  image?: string
  /** 带尺寸标注的工程图路径（public/ 下，详情页大图用），无图不设置 */
  drawing?: string
  /** 3D 模型路径（OBJ，public/ 下，立创导出），无模型不设置 */
  model?: string
  /** 别名（匹配时统一转小写比较），规范名本身自动加入 */
  aliases: string[]
}

export const PACKAGES: PackageMeta[] = [
  // ===== 贴片 =====
  // SOP-8 拆窄体/宽体两条：SPI Flash 两种都在用（如 W25Q128 为 208mil）
  { name: 'SOP-8 150mil', image: '/packages/3d/sop-8-150mil.svg', model: '/packages/models/sop-8-150mil.obj', aliases: ['sop8', 'sop 8', 'sop-8', 'soic8', 'soic-8', 'so-8', 'so8', 'sop8 150mil', 'sop-8 窄体'] },
  // SOP-8 208mil：宽体，依 BY25Q128A 规格书 9.1 节绘制（D 5.23 × E1 5.28，e 1.27）
  { name: 'SOP-8 208mil', image: '/packages/3d/sop-8-208mil.svg', drawing: '/packages/3d/sop-8-208mil-spec.svg', aliases: ['sop8 208', 'sop8 208mil', 'sop-8w', 'sop8w', 'soic8 208', 'soic-8 208mil', 'sop-8 宽体'] },
  // ESOP-8：带散热焊盘的 SOP-8 150mil，复用 SOP-8 150mil 缩略图加中心虚线框区分；
  // 依 datasheet §8.1 ESOP8 尺寸（D 4.90 × E 3.90，E1 6.00，e 1.27，焊盘 D1 3.30 × E2 2.40）
  { name: 'ESOP-8', image: '/packages/3d/esop-8.svg', drawing: '/packages/3d/esop-8-spec.svg', aliases: ['esop8', 'esop 8', 'esop-8', 'esop8 150mil', 'sop8 ep', 'sop-8 ep', 'esop'] },
  // SOP-16 150mil：依 CH552 手册 19.3 绘制（D 10.0 × E1 3.9，E 6.0，e 1.27，b 0.45）
  { name: 'SOP-16 150mil', image: '/packages/3d/sop-16-150mil.svg', drawing: '/packages/3d/sop-16-150mil-spec.svg', aliases: ['sop16', 'sop 16', 'sop-16', 'soic16', 'soic-16', 'so-16', 'sop16 150mil', 'sop-16 150mil'] },
  // SOP-28 300mil：按 TM1638 规格书 P18 尺寸绘制（小图为无标注缩略图，drawing 为带标注工程图）
  { name: 'SOP-28 300mil', image: '/packages/3d/sop-28-300mil.svg', drawing: '/packages/3d/sop-28-300mil-spec.svg', model: '/packages/models/sop-28-300mil.obj', aliases: ['sop28', 'sop 28', 'sop-28', 'soic28', 'soic-28', 'so-28', 'sop28 300mil', 'sop-28 300mil', 'soic-28 300mil', 'sop-28 宽体'] },
  // TSSOP-8：升级为 3d datasheet 版（顶视，pin1 点右上，顶排右起 1→4），依 JEDEC TSSOP-8 尺寸表绘制
  // D 2.90-3.10 / E1 4.30-4.50 / E 6.20-6.60 / e 0.65 BSC / b 0.21-0.30 / L1 1.00 REF
  { name: 'TSSOP-8',  image: '/packages/3d/tssop-8.svg',  drawing: '/packages/3d/tssop-8-spec.svg',  aliases: ['tssop8', 'tssop 8'] },
  { name: 'TSSOP-14', image: '/packages/builtin/tssop-14.svg', aliases: ['tssop14', 'tssop 14'] },
  { name: 'TSSOP-16', image: '/packages/builtin/tssop-16.svg', aliases: ['tssop16', 'tssop 16'] },
  // TSSOP-20：依 HC32L110C6PA 数据手册绘制（D 6.50 × E1 4.40，e 0.65）
  { name: 'TSSOP-20', image: '/packages/3d/tssop-20.svg', drawing: '/packages/3d/tssop-20-spec.svg', aliases: ['tssop20', 'tssop 20'] },
  // TSOP-II 44：ISSI 61-64WV25616 规格书（400mil，D 18.41 × E1 10.16，e 0.80，22+22 脚），顶视图
  { name: 'TSOP-II 44', image: '/packages/3d/tsop-ii-44.svg', drawing: '/packages/3d/tsop-ii-44-spec.svg', aliases: ['tsopii-44', 'tsopii44', 'tsop-ii-44', 'tsop-ii44', 'tsop ii 44', 'tsop2-44', 'tsop-44'] },
  // MSOP-10：依 CH552 手册 19.4 绘制（D 3.0 × E1 3.0，E 4.9，e 0.5，b 0.22）
  { name: 'MSOP-10',  image: '/packages/3d/msop-10.svg',    drawing: '/packages/3d/msop-10-spec.svg', aliases: ['msop10', 'msop 10', 'msop-10'] },
  { name: 'MSOP-8',   image: '/packages/builtin/msop-8.svg',   aliases: ['msop8', 'msop 8'] },
  { name: 'SSOP-8',   image: '/packages/builtin/ssop-8.svg',   aliases: ['ssop8', 'ssop 8'] },
  { name: 'SSOP-20',  image: '/packages/builtin/ssop-20.svg',  aliases: ['ssop20', 'ssop 20'] },
  { name: 'SOT-23-5', image: '/packages/builtin/sot-23-5.svg', aliases: ['sot23-5', 'sot235', 'sot-235'] },
  { name: 'SOT-23-6', image: '/packages/builtin/sot-23-6.svg', aliases: ['sot23-6', 'sot236', 'sot-236'] },
  // SOT-223：3 脚 + 顶部散热片，依 AMD DS1117「3 LEAD SOT-223 PLASTIC PACKAGE」机械图绘制（顶视）
  // E 6.30-6.71 / D 6.71-7.29 / 本体高 3.30-3.71 / 散热片宽 2.95-3.15 / e 2.29 / b 0.84-1.04
  { name: 'SOT-223', image: '/packages/3d/sot-223.svg', drawing: '/packages/3d/sot-223-spec.svg', aliases: ['sot223', 'sot 223', 'sot-223', 'to-261', 'to261'] },
  // TO-252 (DPAK TO252-2)：3 脚 + 宽散热片（带安装孔），依 BL1117「TO252-2」机械图绘制（顶视）
  // E 9.40-10.41 / E1 5.97-6.22 / D1 4.95-5.46 / D2 4.70-4.90 / D 6.35-6.73 / e 2.286 / b 0.65-0.85
  { name: 'TO-252', image: '/packages/3d/to-252.svg', drawing: '/packages/3d/to-252-spec.svg', aliases: ['to252', 'to 252', 'to-252', 'dpak', 'to252-2', 'to-252-2'] },
  // SOD-882 (DFN1006-2 / SC-79)：2 脚无引脚，底视（焊盘面，脚1=切角焊盘），依通用 SOD-882 尺寸表绘制
  // D 0.95-1.05 / E 0.55-0.65 / e 0.65 BSC / b 0.45-0.55 / L 0.20-0.30 / h 0.07-0.17
  { name: 'SOD-882', image: '/packages/3d/sod-882.svg', drawing: '/packages/3d/sod-882-spec.svg', aliases: ['sod882', 'sod 882', 'sod-882', 'sc-79', 'sc79', 'dfn1006-2', 'dfn1006 2'] },
  // SOT-23-3（SOT-23 三脚原型）：顶视，脚3 顶中、脚1/2 底排（e 0.95 / e1 1.9），依通用 SOT-23 尺寸表绘制
  // D 2.80-3.00 / E 1.20-1.40 / E1 2.25-2.55 / e 0.95 TYP / e1 1.80-2.00 / b 0.30-0.50 NOM 0.40 / L 0.55 REF
  { name: 'SOT-23-3', image: '/packages/3d/sot-23-3.svg', drawing: '/packages/3d/sot-23-3-spec.svg', aliases: ['sot23', 'sot 23', 'sot-23', 'sot23-3', 'sot-23-3', 'to-236ab', 'sc-59', 'sc59'] },
  // ===== 无引脚 / 底部焊盘 =====
  // WSON-8 6x8：无引脚封装，正面与 QFN/BGA 难以区分，图一律用底视（焊盘面），依 Winbond ZE 规格绘制
  { name: 'WSON-8 6x8', image: '/packages/3d/wson-8-6x8.svg', drawing: '/packages/3d/wson-8-6x8-spec.svg', aliases: ['wson8 6x8', 'wson-8 6x8', 'wson8-6x8', 'wson-8-6x8', 'wson 8x6', 'wson8 8x6', 'wson-8 8x6', 'wson-8 6x8mm'] },
  // WSON-8 6x5：GD25Q32E 等用的窄体 WSON（b×L 0.40×0.60，散热焊盘 3.4×4.0），同样画底视图
  { name: 'WSON-8 6x5', image: '/packages/3d/wson-8-6x5.svg', drawing: '/packages/3d/wson-8-6x5-spec.svg', aliases: ['wson8 6x5', 'wson-8 6x5', 'wson8-6x5', 'wson-8-6x5', 'wson 6x5', 'wson8 5x6', 'wson-8 5x6', 'wson-8 6x5mm'] },
  { name: 'USON-8',   image: '/packages/builtin/uson-8.svg',   aliases: ['uson8', 'uson 8'] },
  { name: 'DFN-8',    image: '/packages/builtin/dfn-8.svg',    aliases: ['dfn8', 'dfn 8'] },
  // DFN-8 3x3：8 脚无引脚，底视（焊盘面），左右两列各 4 个 U 槽焊盘，EP D2 1.7×E2 2.4 四角 R 0.125
  // D 2.89-3.11 / E 2.89-3.11 / e 0.50 BSC / b 0.175-0.225 / L 0.381-0.419 / K 0.25 REF
  { name: 'DFN-8 3x3', image: '/packages/3d/dfn-8-3x3.svg', drawing: '/packages/3d/dfn-8-3x3-spec.svg', aliases: ['dfn8 3x3', 'dfn-8 3x3', 'dfn 8 3x3', 'dfn8 3x3mm'] },
  // UDFN-8 2x3 (UT)：8 脚无引脚超薄，底视（焊盘面），EP D2 1.4×E2 1.3 右下直切角=pin1（用户拍板不用圆弧）
  // D 1.95-2.05 / E 2.95-3.05 / e 0.50 BSC / b 0.20-0.30 / L 0.20-0.40 / A 0.50-0.60
  { name: 'UDFN-8 2x3', image: '/packages/3d/udfn-8-2x3.svg', drawing: '/packages/3d/udfn-8-2x3-spec.svg', aliases: ['udfn8', 'udfn 8', 'udfn-8', 'udfn8 2x3', 'udfn-8 2x3', 'udfn-8-2x3', 'wdfn8 2x3'] },
  { name: 'QFN-8',    image: '/packages/builtin/qfn-8.svg',    aliases: ['qfn8', 'qfn 8'] },
  { name: 'QFN-24',   image: '/packages/builtin/qfn-24.svg',   aliases: ['qfn24', 'qfn 24'] },
  // QFN-16 3x3：依 CH552 手册 19.2（D/E 3.00，e 0.50，b 0.25，散热焊盘 1.70），底视图
  { name: 'QFN-16 3x3', image: '/packages/3d/qfn-16-3x3.svg', drawing: '/packages/3d/qfn-16-3x3-spec.svg', aliases: ['qfn16', 'qfn 16', 'qfn-16', 'qfn16 3x3', 'qfn16-3x3'] },
  // QFN-28 4x4：依 CH579 数据手册第 21 章（D/E 4.00，e 0.40，散热焊盘 2.80），底视图
  { name: 'QFN-28 4x4', image: '/packages/3d/qfn-28.svg', drawing: '/packages/3d/qfn-28-spec.svg', aliases: ['qfn28', 'qfn 28', 'qfn-28', 'qfn28 4x4', 'qfn28-4x4'] },
  // QFN-32 5x5：依 ESP32-C3 技术规格书 v2.4 §7（D/E 5.00，D2/E2 3.70，e 0.50，b 0.25），底视图
  { name: 'QFN-32 5x5', image: '/packages/3d/qfn-32-5x5.svg', drawing: '/packages/3d/qfn-32-5x5-spec.svg', aliases: ['qfn32', 'qfn 32', 'qfn-32', 'qfn32 5x5', 'qfn32-5x5'] },
  // QFN-48 5x5：依 CH579 数据手册第 21 章（D/E 5.00，e 0.35，散热焊盘 3.70），底视图
  { name: 'QFN-48 5x5', image: '/packages/3d/qfn-48.svg', drawing: '/packages/3d/qfn-48-spec.svg', aliases: ['qfn48', 'qfn 48', 'qfn-48', 'qfn48 5x5', 'qfn48-5x5'] },
  // QFN-56 7x7：依 ESP32-S3 技术规格书 v2.2 §7（D/E 7.00，D2/E2 4.00，e 0.40，b 0.20），底视图
  { name: 'QFN-56 7x7', image: '/packages/3d/qfn-56-7x7.svg', drawing: '/packages/3d/qfn-56-7x7-spec.svg', aliases: ['qfn56', 'qfn 56', 'qfn-56', 'qfn56 7x7', 'qfn56-7x7'] },
  // ===== 直插 =====
  { name: 'DIP-8',    image: '/packages/builtin/dip-8.svg',    aliases: ['dip8', 'dip 8', 'pdip8', 'pdip-8'] },
  { name: 'DIP-14',   image: '/packages/builtin/dip-14.svg',   aliases: ['dip14', 'dip 14', 'pdip14'] },
  { name: 'DIP-16',   image: '/packages/builtin/dip-16.svg',   aliases: ['dip16', 'dip 16', 'pdip16'] },
  // ===== 四边引脚 / 阵列 =====
  { name: 'LQFP-32',  image: '/packages/builtin/lqfp-32.svg',  aliases: ['lqfp32', 'lqfp 32'] },
  // LQFP-48 7x7：依 STM32F103x4/x6 手册 6.5（D/E 9.00，D1/E1 7.00，e 0.50，b 0.22）
  { name: 'LQFP-48 7x7', image: '/packages/3d/lqfp-48-7x7.svg', drawing: '/packages/3d/lqfp-48-7x7-spec.svg', aliases: ['lqfp48', 'lqfp 48', 'lqfp-48', 'lqfp48 7x7', 'lqfp48-7x7'] },
  { name: 'LQFP-64',  image: '/packages/builtin/lqfp-64.svg',  aliases: ['lqfp64', 'lqfp 64'] },
  { name: 'LQFP-100', image: '/packages/builtin/lqfp-100.svg', aliases: ['lqfp100', 'lqfp 100'] },
  { name: 'BGA-64',   image: '/packages/builtin/bga-64.svg',   aliases: ['bga64', 'bga 64'] },
  { name: 'BGA-100',  image: '/packages/builtin/bga-100.svg',  aliases: ['bga100', 'bga 100'] },
  // FBGA-84 8x12.5：DDR2 x16 常用封装，依 EtronTech EM68B16CWQH Figure 48 绘制（底视图，84 球）
  { name: 'FBGA-84 8x12.5', image: '/packages/3d/fbga-84-8x12_5.svg', drawing: '/packages/3d/fbga-84-8x12_5-spec.svg', aliases: ['fbga84', 'fbga 84', 'fbga-84', 'fbga84 8x12.5', 'fbga-84 8x12.5', 'fbga 84-ball', 'bga-84'] },
]

/** 小写 key → 规范名 查找表（模块加载时构建一次） */
const PACKAGE_BY_KEY: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const p of PACKAGES) {
    map[p.name.toLowerCase()] = p.name
    for (const a of p.aliases) {
      const k = a.trim().toLowerCase()
      if (!(k in map)) map[k] = p.name
    }
  }
  return map
})()

const PACKAGE_BY_NAME: Record<string, PackageMeta> = Object.fromEntries(
  PACKAGES.map(p => [p.name, p])
)

/**
 * 封装名标准化
 * "sop8" / "SOIC-8" → "SOP-8 150mil"；"sop8 208" / "sop-8w" → "SOP-8 208mil"
 * 未知封装返回 trim 后的原文
 */
export function normalizePackage(pkg: string | null | undefined): string {
  if (!pkg) return ''
  const trimmed = pkg.trim()
  if (!trimmed) return ''
  return PACKAGE_BY_KEY[trimmed.toLowerCase()] ?? trimmed
}

/** 规范名 → PackageMeta（未收录返回 null） */
export function findPackage(pkg: string | null | undefined): PackageMeta | null {
  const name = normalizePackage(pkg)
  return name ? PACKAGE_BY_NAME[name] ?? null : null
}

/** 封装名 → 图片 URL（无图返回 null） */
export function packageImageUrl(pkg: string | null | undefined): string | null {
  return findPackage(pkg)?.image ?? null
}

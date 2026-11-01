/**
 * Wavefront OBJ 解析器（立创/EasyEDA 导出的封装 3D 模型）
 * 脚本（离线渲染顶视图）与前端组件（PackageModel3D）共用
 * 支持：v 顶点、f 面片（含 v/vt/vn、负数索引、多边形扇形三角化）、内嵌 MTL 的 newmtl/Kd/usemtl
 */

export interface ObjTri {
  a: number
  b: number
  c: number
  /** 漫反射色（Kd 解析结果，0~1），无材质时中灰兜底 */
  color: [number, number, number]
}

export interface ObjModel {
  /** 原始顶点，xyz 连续排列，单位 mm */
  verts: Float32Array
  tris: ObjTri[]
  min: [number, number, number]
  max: [number, number, number]
  /** 上方向轴 = 包围盒 extent 最小的轴（0=x 1=y 2=z），立创模型实测为 z */
  upAxis: 0 | 1 | 2
  /** 图像横轴 = 剩余两轴中 extent 较大者（保证宽体方向横置，符合封装图惯例） */
  imgXAxis: 0 | 1 | 2
  /** 图像纵轴 = 剩余两轴中 extent 较小者 */
  imgYAxis: 0 | 1 | 2
}

export function parseObj(text: string): ObjModel {
  const verts: number[] = []
  const kdByName = new Map<string, [number, number, number]>()
  // 面片先记材质名，最后统一解析颜色（兼容 usemtl 在 newmtl 定义之前的乱序文件）
  const pending: { idx: number[]; mtl: string }[] = []
  let defMtl = ''   // newmtl 语境：当前正在定义的材质名
  let faceMtl = ''  // usemtl 语境：后续面片引用的材质名

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.charCodeAt(0) === 35) continue // 空行/注释
    if (line.startsWith('v ')) {
      const p = line.slice(2).split(/\s+/).map(Number)
      verts.push(p[0]!, p[1]!, p[2]!)
    } else if (line.startsWith('newmtl ')) {
      defMtl = line.slice(7).trim()
    } else if (line.startsWith('Kd ')) {
      const p = line.slice(3).split(/\s+/).map(Number)
      kdByName.set(defMtl, [p[0]!, p[1]!, p[2]!])
    } else if (line.startsWith('usemtl ')) {
      faceMtl = line.slice(7).trim()
    } else if (line.startsWith('f ')) {
      const n = verts.length / 3
      const idx = line.slice(2).split(/\s+/).map((t) => {
        const i = parseInt(t.split('/')[0]!, 10)
        return i < 0 ? n + i : i - 1
      })
      pending.push({ idx, mtl: faceMtl })
    }
  }

  // 多边形扇形三角化
  const tris: ObjTri[] = []
  for (const f of pending) {
    const color = kdByName.get(f.mtl) ?? [0.65, 0.65, 0.65]
    for (let k = 1; k + 1 < f.idx.length; k++) {
      tris.push({ a: f.idx[0]!, b: f.idx[k]!, c: f.idx[k + 1]!, color })
    }
  }

  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < verts.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, verts[i + k]!)
      max[k] = Math.max(max[k]!, verts[i + k]!)
    }
  }
  const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  const upAxis = (ext[0]! <= ext[1]! && ext[0]! <= ext[2]! ? 0 : ext[1]! <= ext[2]! ? 1 : 2) as 0 | 1 | 2
  const rem = ([0, 1, 2] as const).filter(a => a !== upAxis)
  const [imgXAxis, imgYAxis] = ext[rem[0]]! >= ext[rem[1]]! ? rem : [rem[1], rem[0]]

  return { verts: new Float32Array(verts), tris, min, max, upAxis, imgXAxis, imgYAxis }
}

/**
 * 规范化坐标：把模型转到 上=+z、图像横轴=+x、纵轴=+y、中心在原点 的标准系
 * 返回预排列的顶点数组（长度 = 顶点数*3）和最大平面尺寸（用于自适应缩放）
 */
export function canonicalVerts(m: ObjModel): { cv: Float32Array; spanX: number; spanY: number; spanZ: number } {
  const n = m.verts.length / 3
  const cv = new Float32Array(m.verts.length)
  const cx = (m.min[0] + m.max[0]) / 2
  const cy = (m.min[1] + m.max[1]) / 2
  const cz = (m.min[2] + m.max[2]) / 2
  const c = [cx, cy, cz]
  // 长边原本是第二轴时，必须用「旋转 90°」而不是直接交换两轴：
  // 交换两轴的行列式为 -1，等价于镜像，会把 pin1 标记翻到对侧（实测立创 OBJ 即如此）
  const rem = ([0, 1, 2] as const).filter(a => a !== m.upAxis)
  const ySign = m.imgXAxis === rem[1] ? -1 : 1
  for (let i = 0; i < n; i++) {
    cv[i * 3] = m.verts[i * 3 + m.imgXAxis]! - c[m.imgXAxis]!
    cv[i * 3 + 1] = ySign * (m.verts[i * 3 + m.imgYAxis]! - c[m.imgYAxis]!)
    cv[i * 3 + 2] = m.verts[i * 3 + m.upAxis]! - c[m.upAxis]!
  }
  return {
    cv,
    spanX: m.max[m.imgXAxis] - m.min[m.imgXAxis],
    spanY: m.max[m.imgYAxis] - m.min[m.imgYAxis],
    spanZ: m.max[m.upAxis] - m.min[m.upAxis]
  }
}

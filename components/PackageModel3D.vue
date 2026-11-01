<script setup lang="ts">
/**
 * 封装 3D 查看器（Three.js + OBJLoader + OrbitControls）
 * - 模型：立创导出的 OBJ（Z 向上、单位 mm），内嵌 MTL 的 Kd 灰度由本组件读取后转为 PBR 材质
 * - 轴向：模型 (x, y, z) → 世界 (y, z, x) 的循环置换（纯旋转，不镜像），
 *         使顶视时 +X 向右、-Z 向上，与离线顶视图 / 封装外形图惯例一致
 * - 拖拽旋转、滚轮缩放；极角限制在地平线以上，不会钻到封装底部
 * - 仅芯片详情页单实例使用，SSR 期间不加载 three
 */
const props = defineProps<{ src: string }>()

const wrapRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const loading = ref(true)
const failed = ref(false)

// three 资源清理函数（setup 期注册 onUnmounted，避免在 onMounted 内注册钩子）
let cleanup: (() => void) | null = null
onUnmounted(() => cleanup?.())

/** 从 OBJ 内嵌 MTL 读取每个材质名的 Kd 灰度（本类模型 Kd 为等值 RGB） */
function readKdMap(text: string): Map<string, number> {
  const map = new Map<string, number>()
  let cur = ''
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim()
    if (l.startsWith('newmtl ')) cur = l.slice(7).trim()
    else if (l.startsWith('Kd ')) {
      const p = l.slice(3).split(/\s+/).map(Number)
      if (cur && p.length >= 3) map.set(cur, (p[0]! + p[1]! + p[2]!) / 3)
    }
  }
  return map
}

onMounted(async () => {
  const wrap = wrapRef.value
  const canvas = canvasRef.value
  if (!wrap || !canvas) return

  let renderer: any = null
  let controls: any = null
  let scene: any = null
  let frame = 0
  let ro: ResizeObserver | null = null
  const materials: any[] = []
  const geometries: any[] = []

  try {
    const THREE = await import('three')
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js')
    const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')

    const res = await fetch(props.src)
    if (!res.ok) throw new Error(String(res.status))
    const objText = await res.text()
    const kdMap = readKdMap(objText)

    const group = new OBJLoader().parse(objText)
    // Z 向上 → Y 向上，同时把图像横轴对齐世界 +X（循环置换，行列式 +1，不产生镜像）
    group.applyMatrix4(new THREE.Matrix4().set(
      0, 1, 0, 0,
      0, 0, 1, 0,
      1, 0, 0, 0,
      0, 0, 0, 1
    ))

    // OBJLoader 对同一个 object 返回「单网格 + 材质数组 + geometry groups」，
    // 必须按数组逐个替换材质，否则整块封装会被第一个材质刷成同色
    const matCache = new Map<string, any>()
    const makeMat = (name: string) => {
      let mat = matCache.get(name)
      if (mat) return mat
      const gray = kdMap.get(name) ?? 0.7
      const metal = gray > 0.7 // 高灰度 = 引脚金属
      mat = new THREE.MeshStandardMaterial({
        // OBJ 的 Kd 是 sRGB 值，需转到线性工作空间，否则整体会被抬亮成灰白
        color: new THREE.Color().setRGB(gray, gray, gray, THREE.SRGBColorSpace),
        metalness: metal ? 0.65 : 0.06,
        roughness: metal ? 0.28 : 0.6
      })
      matCache.set(name, mat)
      materials.push(mat)
      return mat
    }
    group.traverse((o: any) => {
      if (!o.isMesh) return
      const wasArray = Array.isArray(o.material)
      const olds = wasArray ? o.material : [o.material]
      const next = olds.map((old: any) => {
        const mat = makeMat(old?.name ?? '')
        old?.dispose?.()
        return mat
      })
      o.material = wasArray ? next : next[0]
      geometries.push(o.geometry)
    })

    // 居中
    const box = new THREE.Box3().setFromObject(group)
    const center = box.getCenter(new THREE.Vector3())
    group.position.sub(center)
    const size = box.getSize(new THREE.Vector3())
    const maxSpan = Math.max(size.x, size.y, size.z)

    scene = new THREE.Scene()
    scene.add(group)

    // 光照：环境半球 + 主光 + 补光 + 轮廓光（无 HDR 贴图，用三点光模拟产品照）
    scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2a45, 1.1))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(6, 9, 6)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xa8c8ff, 0.7)
    fill.position.set(-7, 3, 4)
    scene.add(fill)
    const rim = new THREE.DirectionalLight(0xffffff, 0.6)
    rim.position.set(-2, 4, -8)
    scene.add(rim)

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000)
    const fov = (camera.fov * Math.PI) / 180
    const dist = (maxSpan / 2) / Math.tan(fov / 2) * 1.55
    const polar = 0.85, azimuth = 0.6
    camera.position.set(
      dist * Math.sin(polar) * Math.sin(azimuth),
      dist * Math.cos(polar),
      dist * Math.sin(polar) * Math.cos(azimuth)
    )
    camera.lookAt(0, 0, 0)

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    renderer.setClearColor(0x000000, 0)

    controls = new OrbitControls(camera, canvas)
    controls.target.set(0, 0, 0)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.enablePan = false
    controls.minDistance = dist * 0.55
    controls.maxDistance = dist * 2.2
    // 极角 0 = 正上方；限制在地平线以上，避免钻进封装底部
    controls.minPolarAngle = 0.05
    controls.maxPolarAngle = Math.PI / 2 - 0.1
    controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    controls.autoRotateSpeed = 1.1

    const resize = () => {
      const w = wrap.clientWidth, h = wrap.clientHeight
      if (!w || !h) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
    }
    ro = new ResizeObserver(resize)
    ro.observe(wrap)
    resize()

    const animate = () => {
      frame = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()
    loading.value = false

    cleanup = () => {
      cancelAnimationFrame(frame)
      ro?.disconnect()
      controls?.dispose()
      geometries.forEach(g => g.dispose())
      materials.forEach(m => m.dispose())
      renderer?.dispose()
    }
  } catch {
    loading.value = false
    failed.value = true
  }
})
</script>

<template>
  <div ref="wrapRef" class="relative h-72 w-full select-none overflow-hidden rounded-md">
    <canvas ref="canvasRef" class="block h-full w-full cursor-grab active:cursor-grabbing" />
    <p v-if="loading" class="absolute inset-0 flex items-center justify-center text-sm text-ink-tertiary">
      模型加载中…
    </p>
    <p v-if="failed" class="absolute inset-0 flex items-center justify-center text-sm text-ink-tertiary">
      3D 模型加载失败
    </p>
    <p
      v-else-if="!loading"
      class="pointer-events-none absolute bottom-2 right-3 text-[11px] text-ink-tertiary"
    >
      拖拽旋转 · 滚轮缩放
    </p>
  </div>
</template>

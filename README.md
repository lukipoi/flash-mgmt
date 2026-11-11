# flash-mgmt

个人电子元器件库存管理系统。围绕「芯片」为核心，覆盖 Flash / MCU / 其他耗材类元器件的**录入、扫码识别、定位、标签打印、Datasheet 管理**，并集成 USB 编程器与串口读取器做**UID 自动录入**。

> 为个人工作台场景而写：单机运行、本地 SQLite、无需登录，终末地风格信号黄暗色 UI。

## 功能

### 库存核心

- **多类物品**：芯片（flash/mcu/other 三类）、设备、耗材、电路板，各自独立档案与列表
- **录入**：手动表单录入；UID 唯一性校验；JEDEC ID 自动推断厂商/容量；库位三级定位（大箱/小箱/序号）；同型号封装记忆
- **扫码闭环**：打印 UID 二维码标签贴袋 → 摄像头/手机/扫描仪扫码 → 直接跳转详情页（ScanToDetail）
- **标签打印**：德佟 P2 云打印机，5 类标签（芯片/设备/耗材/电路板/容器），预览后 Enter 直接打印
- **Datasheet 管理**：每型号一份规格书，版本管理（上传即追加、可回滚）、URL 直取入库、适用型号别名规则（`STC8H*` 前缀通配）、本地 Acrobat 打开、列表 DS 徽章
- **芯片原件照片**（🧪实验）：扫描仪扫实物照，一颗一张，自动裁白边，录入随扫 / 详情补扫，非强制
- **封装库**：手绘 datasheet 风格封装顶视工程图（DIP/SOP/QFN/LQFP/TSOP/BGA/SOT/TO 等家族），录入型号后缀可自动带出封装（如 STC `xxx-DIP16` → DIP-16）

### UID 自动读取（外设集成）

| 通道 | 硬件 | 方式 |
|---|---|---|
| STC 系列 | USB-TTL / WCH-LinkE | stcgal 串口 BSL（15/12/8 系，UID 取自擦除应答） |
| WCH CH32V | WCH-LinkE | RV 模式 SWD（wlink） |
| WCH CH55x | USB | USB ISP |
| STM32 / GD32 / AT32 / CW32 / CS32 / APM32 / HC32 / HK32 / PY32 | WCH-LinkE | pyOCD CMSIS-DAP（SWD，按 DBGMCU DEV_ID 分家族读 UID/容量） |
| Flash 外置存储 | CH341A | SPI probe（JEDEC ID + 容量） |

DAP/RV 模式自动切换：当天用 ARM 通道读过，STC 通道会自动把 LinkE 切回 RV 并重新定位变更后的串口号。

### 扫描仪快扫（🧪实验）

eSCL 网络直连打印机（免驱、无 USB 占用），整面 200dpi 彩色/灰度，实测 6~8s；无 eSCL 时回退 WIA。用于「扫码查详情」与原件照片。

## 技术栈

- **Nuxt 3** + **@nuxt/ui 3**（Tailwind v4，语义色令牌全部收敛在 `assets/css/endfield/theme.css`）
- **node:sqlite**（原生 SQLite，`server/database/init.ts` 自动建表/迁移）
- **Python 3 子进程**：stcgal / pyOCD / pyserial / PIL（UID 读取、eSCL 扫描、裁图）
- 动效克制规范：≤200ms、只动 opacity/颜色/一条线，权威规范页 `docs/gui-style-guide.html`

## 运行

```bash
npm install
npm run dev        # 默认 http://localhost:3000
```

- 数据库与规格书 / 原件照片自动落在 `data/`（首次运行自动建表），**备份 = 拷整个 `data/` 目录**
- Python 依赖（按需）：`pip install stcgal pyserial pyocd pillow`
- 规格书本地打开需本机装有 PDF 阅读器（默认调系统关联程序）

## 目录速览

```
server/api/          # 后端端点（chips / mcu 读取通道 / datasheets / scanner / print ...）
server/python/       # Python 外设脚本（stc_read / stm32_read / chip_photo / scan_once ...）
server/database/     # SQLite 建表与迁移
public/packages/3d/  # 手绘封装工程图（image=素图, drawing=带尺寸）
components/          # 弹窗/徽章/标签打印等
docs/                # GUI 规范页与动效 demo
```

## 状态

个人自用项目，接口与数据结构无兼容性承诺。

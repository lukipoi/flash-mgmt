# CH55x 串口 ISP 读取实施指导（路线 A：官方 WCHISPTool_CMD）

> 交接文档：交给下一个 agent 执行。目标读者是零上下文的 agent，先通读再动手。
> 项目：`d:\CH341-SPI\flash-mgmt`（Nuxt 3 芯片档案管理，dev server 端口 3080）
> 用户铁律：**时序操作问题先查 datasheet/官方手册，不许瞎试；一切改动用可信数据源确定后方可执行；验证必须走与 UI 完全相同的 API 链路，后台直跑肉眼验证不算数。**

## 1. 目标

在「录入芯片」页的 UID 自动读取面板（`pages/chips/new.vue`）中新增 **CH55x 系列（8051 / 串口 ISP）** 读取器：
通过 WCH-LinkE 的 SERIAL 串口 + 3V3 软件控电，自动让 CH552（沁恒 8051）进入串口 ISP，
读出芯片唯一 ID + 型号信息，自动填表单（vendor=WCH / model / uid / uid_length=8），
并按 UID 查库提示是否已入库。**用户明确不走 USB bootloader**（串口 ISP 不在排除范围）。

## 2. 已实锤事实（本方案的地基，全部官方来源，不要再重新验证结论）

1. **CH55x 无 SWD/JTAG**。WCH 官方脱机烧录器手册（WCH-MCU-DL User Manual）原文：
   "USB and serial port are applicable to all chips, while **SWD mode is only applicable to CH32F/V series**"。
   → wlink.exe / OpenOCD / pyOCD 那条路彻底不通，别浪费时间。
2. **CH552 支持 USB 和串口两种 ISP**。官方产品页特点原文：「内置 2KB BootLoader，支持USB和串口ISP，提供ISP下载库」。
   来源：https://www.wch.cn/products/CH552
3. **串口 ISP 进入条件 = 冷启动 + D+（P3.6/UDP）高电平**。沁恒官方论坛帖（thread-85867）原文：
   「芯片是冷启动过程识别 D+ 引脚的高电平：必要条件 1、冷启动 2、D+ 高电平」。
   最小系统板文档佐证：「上电，D+ 就被上拉，BootLoader 就会触发进入下载模式，配合上位机就可以进行 USB 和串口下载」。
   → 与 STC 的「上电瞬间检测下载口令」是同款时序，**现有 auto-cycle 机制直接复用**。
4. **CH552 有出厂唯一 ID**。官方产品页：「芯片内置唯一ID号」。注意区分：datasheet 里的
   CHIP_ID 寄存器（0xA1h，恒为 52h）是型号标识不是唯一 ID；唯一 ID 通过 ISP identify 应答取。
5. **出厂 2KB bootloader 用户程序删不掉** → 此路对所有 CH55x 通，无「被锁」风险。
6. **现有开源工具（ch55xtool / chprog / isp55e0 / wagiminator/MCU-Flash-Tools）全部只实现了 USB transport**，
   串口层无现成开源实现 → 这就是选路线 A（官方 CLI）的原因。
7. **官方脱机烧录器 WCH-MCU-DL 的串口下载（手册 5.2 节）就是官方上位机驱动串口 ISP 的实证**：
   J5 接线 [G, POW, TX, RX] 直连目标串口，上位机即 WCHISPTool_CMD。

## 3. 硬件接线（WCH-LinkE 全复用，零新采购）

```
WCH-LinkE SERIAL（USB CDC，即现有 stcPortLabel 里的 "WCH-Link SERIAL (COMx)"）:
  TX  → CH552 RXD
  RX  → CH552 TXD
  GND → GND
WCH-LinkE 3V3 输出（wlink set-power 控）:
  → CH552 VCC
  → CH552 D+（P3.6/UDP）跳线   ← 关键：上电瞬间拉高 D+ 触发 ISP
```

说明：
- 冷启动由 `wlink set-power disable3v3 / enable3v3` 控制（现有 `_wlink_power` / auto-cycle 机制）。
- D+ 跳线在 enable3v3 后自然变高电平；若目标板 USB 座同时插着电脑（host 上拉 D+），双上拉无害。
- 最小系统板若有「下载按键」（本质是接 D+ 到 VCC），跳线与其等效。

## 4. 实施步骤

### 步骤 1：下载并验证 WCHISPTool_CMD（先跑通再集成）

1. 从 WCH 官网下载 WCHISPTool / WCHISPTool_CMD（命令行版）。
   放到 `server/python/bin/wch-ispcmd/` 下（与 wlink-win-x86 平级，统一管理）。
2. **待查实**（查官方手册/帮助，不瞎试）：
   - CLI 参数：串口模式选择、目标芯片系列指定（CH55X）、下载/读取命令、
     串口号与波特率参数格式（官方文档：ISP 下载库 / WCHISPTool_CMD 使用说明）。
   - 串口 ISP 默认波特率（CH55x 通常 57600 一类，以官方文档为准）。
3. 手动验证链路（PowerShell，芯片接好 LinkE）：
   ```
   wlink set-power disable3v3
   wlink set-power enable3v3      # 冷启动，D+ 被拉高 → 进 ISP
   WCHISPTool_CMD <串口读取命令>   # 参数格式以官方文档为准
   ```
   验收：能拿到芯片信息应答（含唯一 ID）。**若失败，先查手册改参数，不要反复盲试串口波特率。**

### 步骤 2：后端集成（照抄 CH32V 的架构）

现有架构参照（全部已就位，读代码时对照）：
- `server/utils/scannerRuntime.ts` → `runExe(exePath, args, timeoutMs, onLog)`：通用 exe 运行器，
  stdout/stderr 都按行收集（wlink 正常日志在 stdout、错误在 stderr），返回 `{ok, logs, error}`。
- `server/api/mcu/ch32/read.post.ts` → 最完整的参照：日志缓冲（globalThis `__stcLogs` Map，
  上限 20 份防泄漏）+ 正则解析日志行 + 复用 `GET /api/mcu/stc/log?logId=` 轮询端点。
- `server/api/mcu/stc/read.post.ts` → STC 流程参照（串口 + autoCycle 断电重启）。

新建 `server/api/mcu/ch55/read.post.ts`：
- body: `{ port: string, logId?: string }`
- 流程：wlink set-power disable3v3 → sleep 0.6s → enable3v3（冷启动+D+高）→ WCHISPTool_CMD 串口读信息 → 解析 UID/型号 → 返回 `{ model, uid, uid_length, ... }`
- spawn 细节：WCHISPTool_CMD 的 stdout/stderr 都收进日志缓冲（同 runExe）；
  **若用 Python 包一层，stdout 必须只留最终 JSON**（教训见第 6 节）。
- 重试：自动断电模式下整段「断电→上电→ISP 握手」最多 3 次（参照 `server/python/stc_read.py`
  的 read_chip 重试循环实现，含失败后释放串口、类级补丁只打一次等细节）。

### 步骤 3：前端集成（new.vue，照抄 CH32V 分支）

`pages/chips/new.vue`：
- `readerKinds` 数组加一项 `'CH55x 系列（8051 / 串口 ISP）'`（现有三项：STC / WCH CH32V / GD32·ARM 占位）。
- 顶部按钮区加 `v-else-if="readerKind.includes('CH55x')"` 分支：「读取CH55x信息」按钮，
  照抄 CH32V 的按钮（无红按钮——ISP identify 只读，无擦除概念）。
- 内容区加对应 `v-else-if` 分支：接线提示文字 + `ch55xMatched` 已入库提示条
  （照抄 `ch32Matched` 的蓝色提示条实现，含「打开档案」按钮）。
- `doCh55xRead()` 照抄 `doCh32Read()`：logId → 日志框 → POST → 填
  `form.vendor='WCH'` / `form.model` / uid 两两分组 / `uid_length` →
  POST `/api/identify`（body `{jedec_id:'', uid, uid_length, chip_type:'mcu'}`）→ matched 则提示。
- 注意：CH55x 需要**选串口**（和 STC 一样用 LinkE SERIAL），复用现有
  `stcPorts` / `stcPortLabel` 选择器与 `stcAutoCycle` 勾选（串口 ISP 与 STC 同样依赖冷启动断电重启）。

## 5. 验收标准

1. UI 点「读取CH55x信息」→ 日志框透传 wlink + WCHISPTool_CMD 原文 → 自动填
   vendor/model/uid/uid_length → toast 成功提示。
2. 连续读 2-3 次 UID 一致（走 UI 同款 API 链路验证，不是后台直跑）。
3. 库内同型号触发封装记忆 toast（该功能已在，勿动）。
4. 读入过库的 CH55x → 面板出现「该 UID 已入库」提示条。
5. 拔掉芯片/接错线 → 报错信息可读（转人话，不裸吐工具报错），日志框可见原文。

## 6. 前人踩过的坑（务必记住，别重蹈覆辙）

1. **stdout 污染**：wlink 的 INFO 日志若混进 stdout 会导致 JSON 解析失败。
   Python 包装时 `sys.stdout` 只留最终 JSON，日志全转 stderr（见 stc_read.py 头部做法）。
2. **HMR 验证假阴性**：前端中文注释/引号被编译压缩，肉眼看 HMR 结果不可靠，
   改前端后必须走 API 或浏览器实测。
3. **WMI 设备事件监听不可靠**（用户实测「极其的不稳定」），串口插拔热刷新已用
   注册表 SERIALCOMM 0.8s 轮询方案（server/utils/serialEvents.ts），不要改回去。
4. **stcgal 时序教训**：connect() 的检测循环容忍脏帧，但后续单发读包零容忍——
   CH55x 的 ISP 握手同理要考虑上电瞬间串口垃圾字节，所以步骤 2 里写了重试循环。
5. **用户情绪管理**：连续失败会让用户炸毛（原话「有完没完」）。一次把验证做扎实
   （连跑 2-3 次全过再交付），别挤牙膏式修。

## 7. 用户既定偏好（新功能的隐含规范）

- 折叠面板 + 读取器系列菜单，新增系列只往 `readerKinds` 数组添项，不全列出来。
- 型号/品牌/UID/长度尽量自动填（读出来即确认品牌）。
- 实时日志框：黑底绿字，工具原文透传不翻译，跑完自动关，busy 时不可关闭。
- 非 WCH-Link 串口禁用自动断电（watch stcPortLabel 已实现）。
- 后续规划：GD32/ARM Cortex-M（SWD）读取器仍是占位；芯片档案可选字段
  voltage / datasheet / marking 暂缓。

---

## 8. 实施记录（2026-10-31，接手 agent 完成代码侧，待真机验证）

路线 A 微调：官方 WCHISPTool_CMD 的 Windows 版 zip 里**没有 exe/DLL**（只有 Linux/macOS 编译产物），
Windows/README 指向 WCHISPTool_Setup.exe。实际做法改为**直接调官方 ISP 库**（比 CLI+ini 路线干净，
`SetIspOption` 是纯内存调用，不需要 WchIspStudio 生成 Config.ini）：

- 已装官方 `WCHISPTool_Setup`（`C:\WCH.CN\App\WCHISPTool\`），取 `WCH55xISPDLL.dll`（x86, stdcall）。
- 新增 `server/python/bin/wch-ispcmd/Windows/ch55x_identify.c/.exe`（MSYS2 mingw32 gcc 编译，32 位）：
  LoadLibraryEx + GetProcAddress 调 `WCH55x_SetIspOption` → `WCH55x_EnumDevices`（串口模式扫全串口握手）
  → `WCH55x_GetIspDeviceInfor`（**IspMcuUID[8]** / IspVer / McuType），stdout 只出最终 JSON。
  关键实锤（反汇编 DLL）：内部设备结构步长 0x1A2=418 字节；Isp55xDevInforS 固定前缀
  Index@0/McuType@4/IsSupportUID@5/IspVer@9/UID@13/PortName@21；Baud[4] 在 CH55xIspOptionS 的
  Windows 偏移 947 / Linux 偏移 935（两个都写）。日志纯 ASCII（管道分块会切碎多字节字符）。
- 后端 `server/api/mcu/ch55/read.post.ts`：autoCycle 时 wlink 控电（断 3V3 → 0.6s → 上电 → 0.2s 后握手），
  整段重试 3 次（无控电 2 次），日志复用 `__stcLogs`，按端口+uid_valid 挑设备。
- 前端 `new.vue`：readerKinds 加「WCH CH55x 系列（8051 / 串口 ISP）」，按钮/接线提示/已入库提示条，
  `doCh55xRead()` 照抄 doCh32Read。
- 已验证（无芯片）：exe 空跑 2 串口优雅返回 `{"ok":true,"devices":[]}`；走 dev server API 链路
  POST /api/mcu/ch55/read 返回人话报错；logId 日志轮询正常。
- **待真机验证**（用户接线后点 UI）：LinkE TX→RXD / RX→TXD / GND / 3V3→VCC+D+ 跳线，勾自动断电重启，
  点「读取CH55x信息」连续读 2-3 次 UID 一致。若握手失败优先查波特率（工具默认 115200，可改 --baud）。

## 9. 改道 USB ISP（2026-10-31 晚，用户拍板「串口太诡异，改 USB」）

串口方案完整保留在工具里（`--port/--baud`，后端 `mode:'serial'`），但 UI 默认走 USB：

- 工具加 `--usb`：`IspInterface=0`，`EnumDevices` 枚举 BOOT 下的 USB 设备（CH55x BOOT 模式
  **USB PID=0x55E0**，PDF 官方原文），**设备信息（含 UID）直接在枚举结果里**（偏移同固定前缀，
  步长 418B），不需要 GetIspDeviceInfor（头文件注明它仅串口模式用）。
- USB 模式走官方 CH375 驱动链（DLL 内部用 CH375DLL.dll），**驱动已随 WCHISPTool_Setup 装好**；
  若枚举不到设备，去设备管理器看有没有 PID 0x55E0 的 WCH 设备，没有就重跑 Setup 或手动装
  安装目录里的驱动 INF。
- 后端 `mode:'usb'`（默认）：无串口、无控电，重试 2 次枚举；前端 CH55x 分支去掉端口选择，
  提示「冷启动（断电插 USB 上电）即进 BOOT」。
- 空 API 已验证：枚举 0 设备 → 人话报错「未枚举到 CH55x BOOT 设备（…PID 0x55E0…）」。
- **待真机（用户 USB 插座到货）**：冷启动插 USB → 点「读取CH55x信息」→ UID 应出现；
  连读 2-3 次一致即验收通过。

## 10. 最终形态（2026-10-31 深夜，真机验收通过 ✅）

路线 A（官方 CLI）和 WCH55xISPDLL 路线全部废弃，最终方案 = **CH375DLL 传输层 + ch55xtool 开源协议栈**（用户拍板"换开源就爆改"）：

- `server/python/bin/wch-ispcmd/Windows/ch55x_identify.c/.exe`（mingw32 32 位）：
  - 传输：CH375DLL.dll（官方 SOURCE37.ZIP 开发包有头文件；设备绑 CH375_A64 驱动，免 Zadig）
  - 协议：ch55xtool (GPL-3.0) 的 CH55x USB ISP——包 = 命令+u16LE长度+载荷，Detect(0xA1,
    载荷 \x42\x10+"MCU ISP & WCH.CN") 拿 chip_id/subid，ReadConfig(0xA7, FLAG_BOOTVER|FLAG_UID) 拿 UID+BOOT 版本
  - 设备发现不用描述符过滤（部分 CH375 驱动 GetDeviceDescr 拿不到），直接对每个可打开的
    CH375 index 发 Detect 探测——应答本身就是过滤器；两轮探测抗设备挂起
  - subid=0x11 的芯片 UID 只有 4 字节 + 补零（ch55xtool 已知特例）
- WCH55xISPDLL 路线死因（反汇编实锤，供后人）：EnumDevices 依赖「当前设备指针」(0x100219d8)，
  只有 CH375 插拔通知回调会填它，程序启动前已插上的设备永远过不了闸；且 CH375DLL.dll 是
  LoadLibraryW 动态加载（只搜 exe 目录）。CH375DLL.dll 已复制到 exe 目录。
- 后端 USB 模式重试链：失败 → wlink 断电重启（芯片重上电 = USB 拔插事件，清挂起/楔死状态）→ 重试，最多 3 次。
- **已验收**：UI 同款 API 连读 5 次 UID 一致（0C909EBE00000000，BOOT 2.50）；楔死自恢复流程日志可见；
  报错人话；logId 日志透传正常。
- 副作用提醒：读 UID 后芯片停在 BOOT；D+ 上拉装着时冷启动永远进 BOOT，跑用户程序需断开上拉。

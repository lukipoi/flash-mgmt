# CH552G USB ISP 读取：完整测试记录（含全部坑点与尝试）

> 日期：2026-10-31 深夜
> 目标芯片：CH552G（SOP16，出厂 BOOT 2.50）
> 结果：✅ 读取器上线，UID 读取稳定，已入库芯片复测闭环
> 位置：`flash-mgmt` 录入芯片 → MCU → UID 自动读取 → 「WCH CH55x 系列（8051 / USB ISP）」

---

## 0. TL;DR（最终形态）

**CH375DLL.dll 传输层 + ch55xtool 开源协议栈，自搓 identify 工具，免 Zadig。**

```
录入页点「读取CH55x信息」
  → 后端 spawn ch55x_identify.exe（32 位，LoadLibrary 官方 CH375DLL.dll）
  → CH375OpenDevice 逐 index 探测 → 发 Detect(0xA1) 拿 chip_id/subid
  → ReadConfig(0xA7) 拿 UID(8B) + BOOT 版本(4B)
  → stdout 出 JSON → 后端填表单 → /api/identify 查库 → 命中弹「已入库」提示条
```

实测：连读 5 次 UID 零漂移，首次 ~3s，后续 **~280ms/次**；查库命中已入库档案 ✓。
设备故障自恢复：失败后自动 `wlink set-power` 断电重启再试（最多 3 次）。

---

## 1. 硬件接线（最终版，全部官方来源核对过）

CH552G SOP16 引脚（CH552DS1 官方表格 SOP16 列）：

| 脚号 | 名称 | 接向 |
|---|---|---|
| 15 | VCC/VDD | wlink 3V3，就近 0.1uF 去耦 |
| 16 | V33 | **直连 VCC**（供电 <3.6V 时 datasheet 要求外部供电进 V33） |
| 14 | GND | 共地（LinkE GND + USB GND） |
| 12 | P3.6/UDP | USB **D+**，直连不串电阻 |
| 13 | P3.7/UDM | USB **D-**，直连不串电阻 |

进 BOOT 的扳机：**冷启动 + D+ 高电平**（官方论坛 thread-85867 原文实锤）。D+ 挂 **6.8k 上拉到 VCC**。

### 接线坑点

| # | 坑 | 说明 |
|---|---|---|
| H1 | 网上卖家页引脚表是错的 | 某站点写"VCC=12/GND=11/UDP=14"，全错。以 datasheet 表格为准（SOP16：UDP=12, UDM=13, GND=14, VCC=15, V33=16） |
| H2 | D+ 上拉**只能拉到 3.3V** | datasheet 原文：P3.6/P3.7 内部用 V33 供电，5V 不支持。即使 VCC 吃 5V，上拉也只能到 V33 |
| H3 | D+/D- **不得串电阻** | datasheet 原文（USB 用途时） |
| H4 | 6.8k 上拉的擦边问题 | USB 主机 15k 下拉会分压：1.5k→3.0V 稳、6.8k→2.27V 压线。**对策：先上电后插 USB**（上电瞬间无主机分压，D+ 实打实 3.3V → 稳进 BOOT；BOOT 自带 1.5k 内部上拉接管后主机正常枚举） |
| H5 | USB GND 必须与供电共地 | 独立 3.3V 供电方案下 D± 以 GND 为参考，不共地必挂 |
| H6 | VBUS 悬空 | 独立供电方案 USB 的 5V 不接，防倒灌 |

---

## 2. 奋斗史：四条路线，三死一活

### 路线 A：官方 WCHISPTool_CMD（计划路线，未出生即死）

- 官网下了 `WCHISPTool_CMD.ZIP v4.0`（3.95MB），解压发现 **Windows 目录只有 README**——exe 要装 GUI 的 WCHISPTool_Setup.exe，zip 只带 Linux/macOS 编译产物。
- 官方 CLI 文档只有 `program/verify/-v`（版本号），**没有 identify 操作**；配置文件要 WchIspStudio 图形界面生成。此路文档层面就不适合做只读读取器。

### 路线 B：WCH55xISPDLL 直调（走了很远，反汇编扒穿后放弃）

装了官方 `WCHISPTool_Setup`（`C:\WCH.CN\App\WCHISPTool`），拿到 `WCH55xISPDLL.dll`（x86/stdcall）。头文件（Linux 变体）明文写了串口/USB 调用流程，看起来很美好：

```
1. WCH55x_SetIspOption(&opt)   ← 纯内存调用，不需要 ini
2. WCH55x_EnumDevices(...)     ← USB 模式枚举 BOOT 设备
3. WCH55x_GetIspDeviceInfor()  ← 拿 UID
```

**结果：EnumDevices 永远返回 0。** 反汇编扒穿了死因链（这些是通用教训）：

| # | 坑 | 细节 |
|---|---|---|
| B1 | **枚举靠「插拔通知」而非「扫描」** | EnumDevices 开头检查「当前设备指针」（.data 0x100219d8），该指针只有 CH375 插拔通知回调（隐藏窗口消息派发）才会填。**芯片在程序启动前就插好的话没有插拔事件 → 指针恒 0 → 枚举永远 0 台**。wlink 断电重启制造真实拔插事件也没救回来（注册时机在 DLL 内部深处的消息泵里） |
| B2 | **CH375DLL.dll 是 LoadLibraryW 动态加载** | 只搜「exe 所在目录」不搜 ISP DLL 自己的目录；官方 GUI 能用纯因为 exe 同目录。复制 CH375DLL.dll 到 exe 旁边可解 |
| B3 | **不核实签名的 DLL 函数绝不能调** | `CH375SetTimeout` 按 (idx, 5000, 5000) 三参猜着调，实际参数布局不符 → stdcall 栈被踩坏 4 字节 → 后续 WriteData/ReadData 全部报错 31，管道楔死到设备重新枚举才恢复。**血泪：调用 DLL 函数前必须从导出表/官方头文件核实参数个数** |
| B4 | **pipe 楔死的症状与救法** | 错误码 31（ERROR_GEN_FAILURE）= 设备无响应；楔死后唯一救法是让设备重新枚举（断电重启/拔插）。诊断手法：GetDeviceDescr/GetConfigDescr 能拿到 18B/32B 描述符 = 设备健康，拿不到 = 楔死 |

### 路线 C：串口 ISP（WCH-LinkE SERIAL + wlink 控电）

按官方手册搭了完整链路（TX/RX/GND/3V3+D+ 跳线，wlink 软件控电冷启动，AutoProtocol 重试 3 次）。**用户实测「太诡异搞不定」，放弃**。技术遗留：串口方案代码完整保留（`ch55x_identify.c` 旧版 + 后端 `mode:'serial'`），哪天想折腾还在。

### 路线 D（最终）：CH375DLL 传输 + ch55xtool 开源协议 ✅

用户拍板「换开源吧」，给了官方 `SOURCE37.ZIP`（CH375 开发包：CH375DLL.H/C + WDM 源码 + 例程），配合 GPL 开源 `ch55xtool`（MarsTechHAN/ch552tool）的协议实现，自己搓 C 工具。

**为什么这条路能通而路线 B 不能**：绕开了 ISP DLL 的所有内部状态机（通知闸门、动态加载、句柄管理），自己用 CH375OpenDevice 打开设备（实测 handle=616/604，打开即成功），直接按 ch55xtool 的协议格式收发。

---

## 3. CH55x USB ISP 协议速查（自 ch55xtool 反推，GPL-3.0）

- USB：VID `0x4348` / PID `0x55E0`，两对 bulk 端点 **EP2 OUT(0x02) / EP2 IN(0x82)**，maxpkt 64
- 命令帧：`命令码(1B) + 载荷长度 u16LE + 载荷`
- 应答帧：`命令回显(1B) + 状态(1B) + 载荷长度 u16LE + 载荷` —— **状态字节非 0 不是错误**（Detect 实测回 0xD7），帧格式对 + 长度对即可
- `Detect(0xA1)`：载荷 = `\x42\x10` + `"MCU ISP & WCH.CN"`(共 18B) → 应答载荷 2B = `chip_id, chip_subid`
- `ReadConfig(0xA7)`：载荷 = 请求字段 u16LE（`FLAG_BOOTVER=0x08 | FLAG_UID=0x10`）→ 应答载荷 = 回显字段 u16LE + BOOT 版本 4B + UID 8B
- **subid=0x11 特例**：UID 只有 4 字节，高位补 4 个 0x00（chip_id 不在 0x55/56/57 时）
- chip_id → 型号（typeall.wcfg 官方映射）：0x51=CH551, **0x52=CH552**, 0x54=CH554, 0x58=CH558, 0x59=CH559, 0x44~0x49=CH544~549 ...
- 只读流程 = Detect + ReadConfig，**无任何擦/写命令**（WriteData/ReadData 是传输层 API，不是 Flash 操作，勿混淆）

---

## 4. 软件坑点（代码层）

| # | 坑 | 说明/对策 |
|---|---|---|
| S1 | **mingw32 gcc 编译静默失败** | `D:\msys64\mingw32\bin\gcc.exe` 直接跑 exit=1 无任何输出（as/ld 找不到）。必须 `PATH="/d/msys64/mingw32/bin:$PATH"` 再编译 |
| S2 | **`typedef void VOID;` 撞 windows.h** | mingw 的头文件已定义 VOID，重复 typedef 报错。自写 Windows 工具别重定义标准类型 |
| S3 | **CH375DLL.dll 加载要用 `LoadLibraryExA` + `LOAD_WITH_ALTERED_SEARCH_PATH`** | 它还依赖同目录的其他 DLL，普通 LoadLibrary 的依赖搜索不含 DLL 自身目录 |
| S4 | **CH375OpenDevice 返回 ULONG 不是 HANDLE** | 无效 = 0xFFFFFFFF；按 HANDLE 处理会在 64 位下误判（本次 32 位侥幸没炸，但类型要写对） |
| S5 | **设备描述符过滤不可靠** | `CH375GetDeviceDescr` 在部分驱动/设备组合下拿不到数据（错误 31）。改用「Detect 应答即过滤器」——18 字节魔数应答只有 CH55x BOOT 能给 |
| S6 | **设备空闲会挂起** | 芯片/驱动闲置 ~1 分钟后 WriteData/ReadData 报 31，重开进程也没用。对策双层：工具内两轮探测（间隔 700ms）+ 后端失败后 wlink 断电重启再试 |
| S7 | **wlink 断电重启 = USB 层拔插事件** | 芯片重上电会让 USB 总线真实 disconnect/connect，这是恢复挂起设备、触发重枚举的万能钥匙（wlink 3V3 供电方案的隐藏福利） |
| S8 | **exe 内 log 用纯 ASCII** | C 程序中文日志经管道按行切分时多字节字符会被切碎（Node 侧按 chunk 分行）。日志写英文，JSON 输出不受影响 |
| S9 | **stdout 只放最终 JSON** | 与 stc_read.py 同款约定：过程日志全走 stderr，stdout 一行 JSON，防止日志混入破坏解析 |

---

## 5. 验收数据（2026-10-31 真机）

### 换芯稳定性测试（入库芯片，#49 CH552G）

| 次数 | 耗时 | UID |
|---|---|---|
| 1 | 2972ms* | 3AD6F5BD00000000 |
| 2 | 278ms | 同 |
| 3 | 278ms | 同 |
| 4 | 273ms | 同 |
| 5 | 304ms | 同 |

\* 首次含 DLL 加载与设备唤醒开销，之后稳定 ~280ms/次。5/5 成功，UID 零漂移。

### 查库闭环

读出 UID `3AD6F5BD00000000` → `POST /api/identify` → `matched:true, match_by:'uid'` → 命中 2026-08-16 入库的 CH552G 档案（#49）。UI 表现：蓝色提示条「该 UID 已入库：CH552G」+ 打开档案按钮。

### 楔死自恢复实测

人为等待设备挂起后调用 API：第 1 次尝试失败（错误 31）→ 日志框可见 → 后端自动 `wlink set-power disable3v3/enable3v3` → 第 2 次尝试成功。全程 UI 无感，无需手动拔插。

---

## 6. 已知副作用与注意事项

1. 读 UID 后芯片**停在 BOOT**（ISP 会话未 End）；重新上电即回用户程序
2. D+ 上拉电阻装着时，**每次冷启动都进 BOOT**，用户程序跑不起来——量产/运行固件时需断开上拉（或换成 BOOT 按钮：按住上电=进 BOOT）
3. 官方 WCHISPTool 与本读取器共用 CH375 驱动，互不冲突；但若哪天用 Zadig 换了驱动，两边一起失效（当前方案无需 Zadig）
4. `ch55xtool` Python 包已装进 Python314（走 libusb 路线用），当前后端不依赖它，仅作协议参考源
5. 串口 ISP 路线代码完整保留（后端 `mode:'serial'`），但前端已切 USB

---

## 7. 文件清单

| 文件 | 说明 |
|---|---|
| `server/python/bin/wch-ispcmd/Windows/ch55x_identify.c/.exe` | 识别工具（CH375DLL + ch55xtool 协议），32 位 |
| `server/python/bin/wch-ispcmd/Windows/CH375DLL.dll` | 官方传输层 DLL（从 WCHISPTool 安装目录复制） |
| `server/python/bin/wch-ispcmd/Windows/ch375_probe.c/.exe` | 传输层探针（dump 描述符/端点，诊断用） |
| `server/python/bin/wch-ispcmd/ch375-sdk/` | SOURCE37.ZIP 解包（官方 CH375 开发包） |
| `server/api/mcu/ch55/read.post.ts` | 后端 API（USB 重试链 + wlink 恢复 + 日志缓冲） |
| `pages/chips/new.vue` | 前端 CH55x 读取器分支 |
| `CH55X_ISP_GUIDE.md` | 交接文档（第 8~10 节 = 本次的实施记录） |
| `C:\WCH.CN\App\WCHISPTool\` | 官方安装（驱动 CH375_A64 来源），勿删 |

## 8. 复现步骤（换一台电脑）

1. 安装官方 WCHISPTool_Setup（提供 CH375WDM 驱动 + CH375DLL.dll）
2. 接线（第 1 节），wlink 3V3 供电，USB 插电脑
3. 设备管理器确认 `USB Module`（VID 0x4348 / PID 0x55E0）绑定 CH375 驱动
4. `wlink set-power enable3v3` 冷启动进 BOOT
5. 录入页 → MCU → UID 自动读取 → 「WCH CH55x 系列（8051 / USB ISP）」→ 点读取
6. 连读 2-3 次 UID 一致即验收通过

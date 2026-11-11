#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cw32_read.py — WHXY 武汉芯源 CW32 系列 SWD 信息读取（只读 identify）【CW32 专属通道】

架构：
  传输层：pyOCD（CMSIS-DAP = WCH-LinkE DAP 模式，免驱）
  目标：generic cortex_m（attach 模式，不打扰运行中的芯片）
  识别：数字签名区（出厂编程，SWD 或 CPU 均可读）——
    CW32L010 没有 ST/GD 式 DBG DEV_ID 寄存器，芯片直接在签名区放 ASCII 型号字符串，
    自报家门，比 DEV_ID 查表更直接：
    - UID（80bit）        @ 0x0010 07B0 - 0x0010 07B9   共 10 字节
    - 引脚数量            @ 0x0010 07D5                 1 字节（0x14 = 20Pin）
    - SRAM 容量（字节）    @ 0x0010 07D6 - 0x0010 07D7   2 字节（0x1000 = 4KB）
    - FLASH 容量（字节）   @ 0x0010 07D8 - 0x0010 07DB   4 字节（0x8000 = 32KB）
    - 产品型号（ASCII）    @ 0x0010 07E0 - 0x0010 07EF   16 字节，不足补 0x00，字母大写
      （例 CW32L010F8U6 → 43 57 33 32 4C 30 31 30 46 38 55 36 00 ...）

来源实锤（CW32L010 用户手册 CN Rev1.1）：
  §24.2 UID 寄存器（80bit）@0x0010 07B0
  §24.3 产品型号寄存器      @0x0010 07E0
  §24.4 FLASH 容量寄存器    @0x0010 07D8
  §24.5 SRAM 容量寄存器     @0x0010 07D6
  §24.6 引脚数量寄存器      @0x0010 07D5
  另：§23.8 —— 深度休眠下 DAP 不工作，无法连接（芯片醒着才能读）。

顺序坑（H7-TOOL 社区实测）：CW32L010 需先读一次 IDCODE（DP 读取），随后执行内存读
UID 才有反应；直接首读 UID 可能拿到假数据。脚本按「IDCODE → CPUID → 签名区」顺序走。

CPUID（0xE000ED00）预期 0x410CC601（M0+ r0p1），用于诊断（H7-TOOL 实测参考值）。
首版只收录 CW32L010（型号字符串前缀 "CW32L010"）；其他 CW32 家族读到字符串后
自然报出全名，不猜地址——签名区布局如跨家族有差异需查对应 UM 补证。

前置：WCH-LinkE 处于 DAP 模式（API 层已做模式保险）。
接线：SWDIO / SWCLK / GND / 3V3。

stdout 只输出最终 JSON；过程日志全走 stderr（ASCII）。
"""

import sys
import json
import logging

logging.getLogger('pyocd').setLevel(logging.WARNING)
logging.basicConfig(level=logging.WARNING)

# 数字签名区地址（CW32L010 UM Rev1.1 §24 实锤）
UID_ADDR = 0x001007B0
UID_LEN = 10
PINCOUNT_ADDR = 0x001007D5
SRAM_SIZE_ADDR = 0x001007D6
FLASH_SIZE_ADDR = 0x001007D8
MODEL_ADDR = 0x001007E0
MODEL_LEN = 16

CPUID_ADDR = 0xE000ED00

# 已核验布局的家族前缀（首版仅 CW32L010；其余家族报全名但标记 matched_table=False）
KNOWN_PREFIXES = ('CW32L010',)


def log(msg):
    print(msg, file=sys.stderr)
    sys.stderr.flush()


def out_json(obj):
    print(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()


def read_uid_verified(target, addr, n, label='UID', tries=5):
    """双读校验：同一地址连读两次，一致才采信；不一致自动重试。
    防极小概率误码/供电不稳读数污染（VCAP 悬空血泪教训，2026-11-06）。
    耗尽 tries 轮仍不一致则抛 RuntimeError（由 main 统一转 read_failed）。"""
    a = b = None
    for i in range(1, tries + 1):
        a = bytes(target.read_memory_block8(addr, n))
        b = bytes(target.read_memory_block8(addr, n))
        if a == b:
            if i > 1:
                log('[INFO] %s 第 %d 轮双读一致' % (label, i))
            return a
        log('[WARN] %s 第 %d 轮双读不一致: %s / %s，重试...'
            % (label, i, a.hex().upper(), b.hex().upper()))
    raise RuntimeError('%s 连续 %d 轮双读均不一致（疑似 VCAP/供电问题）: %s / %s'
                       % (label, tries, a.hex().upper(), b.hex().upper()))


# pyOCD 常见 attach 异常 → 中文提示（原始英文报错仍附在 hint 尾部与日志，便于精确定位）
def friendly_error(e):
    s = str(e)
    low = s.lower()
    if 'no ack' in low:
        return ('SWD 无应答（No ACK）：九成是杜邦线接触不良——压紧或换线；'
                '再核对 SWDIO/SWCLK/GND/3V3 四线有无接错、芯片是否上电')
    if 'timeout' in low:
        return 'SWD 通信超时：检查接线与芯片供电，可尝试降低调试时钟'
    if 'not found' in low or 'no probe' in low:
        return '未检测到调试探针：确认 LinkE 已插 USB 且处于 DAP 模式'
    return 'SWD 附加失败'


def main():
    log('[INFO] CW32 SWD reader start (pyocd CMSIS-DAP)')

    from pyocd.probe.aggregator import DebugProbeAggregator
    probes = DebugProbeAggregator.get_all_connected_probes()
    if not probes:
        out_json({'ok': False, 'error': 'no_probe',
                  'hint': '未检测到 CMSIS-DAP 探针（确认 WCH-LinkE 处于 DAP 模式、已插 USB）'})
        sys.exit(0)
    probe = None
    for p in probes:
        if 'wch' in (p.vendor_name or '').lower():
            probe = p
            break
    if probe is None:
        probe = probes[0]
    log('[INFO] probe: %s %s (%s)' % (probe.vendor_name, probe.product_name, probe.unique_id))

    # ---- 顺序坑第一步：先读 IDCODE（DP 层），CW32 签名区内存读才可靠 ----
    # 注：pyOCD 0.44 的 CMSISDAPProbe 没有 read_idcode 方法（真机实测）；而 Session.open()
    # 建会话时本身就会读一次 DP_IDCODE，顺序坑等效满足。因此这里只做方法探测，没有就跳过。
    idcode = 0
    read_idcode_fn = getattr(probe, 'read_idcode', None)
    if callable(read_idcode_fn):
        try:
            idcode = read_idcode_fn() or 0
            log('[INFO] IDCODE = 0x%08X' % idcode)
        except Exception as e:
            log('[WARN] read_idcode failed: %s（继续尝试内存读）' % e)
    else:
        log('[INFO] probe 无 read_idcode 方法（Session.open 时已读 DP_IDCODE，顺序坑等效满足）')

    from pyocd.core.session import Session   # pyocd 0.44+：Session 在 core 下
    try:
        session = Session(probe, target_override='cortex_m')
        session.open()
    except Exception as e:
        log('[ERR] attach failed: %s' % e)
        out_json({'ok': False, 'error': 'attach_failed',
                  'hint': '%s（原始报错: %s）' % (friendly_error(e), e)})
        sys.exit(0)

    target = session.target
    try:
        # ---- CPUID 诊断（M0+ 预期 0x410CC601）----
        cpuid = 0
        try:
            cpuid = target.read32(CPUID_ADDR)
            log('[INFO] CPUID @0x%08X = 0x%08X' % (CPUID_ADDR, cpuid))
        except Exception as e:
            log('[WARN] CPUID read failed: %s' % e)
        if not cpuid or cpuid == 0xFFFFFFFF:
            out_json({'ok': False, 'error': 'no_device',
                      'hint': 'CPUID 无有效应答（确认 SWD 四线、芯片上电；'
                              '深度休眠状态下 DAP 不工作，CW32 UM §23.8）'})
            sys.exit(0)

        impl = (cpuid >> 24) & 0xFF    # Implementer[31:24]（0x41 = ARM）
        part = (cpuid >> 4) & 0xFFF    # PartNo[15:4]（M0+ = 0xC60）
        log('[INFO] implementer=0x%02X partno=0x%03X (M0+ expect 0xC60)' % (impl, part))

        # ---- 数字签名区（双读校验）----
        uid_bytes = read_uid_verified(target, UID_ADDR, UID_LEN, 'CW32 UID')
        uid = bytes(uid_bytes).hex().upper()

        model_raw = bytes(target.read_memory_block8(MODEL_ADDR, MODEL_LEN))
        model = model_raw.split(b'\x00')[0].decode('ascii', 'replace').strip()
        log('[INFO] model_raw: %s' % model_raw.hex().upper())
        log('[INFO] model: %r' % model)

        pin_count = None
        sram_kb = None
        flash_kb = None
        try:
            pin_count = target.read8(PINCOUNT_ADDR)
            sram_kb = int.from_bytes(target.read_memory_block8(SRAM_SIZE_ADDR, 2), 'little') // 1024
            flash_kb = int.from_bytes(target.read_memory_block8(FLASH_SIZE_ADDR, 4), 'little') // 1024
        except Exception as e:
            log('[WARN] capacity read failed: %s' % e)

        log('[INFO] UID(%dB): %s' % (UID_LEN, uid))
        log('[INFO] pins=%s sram=%sKB flash=%sKB' % (pin_count, sram_kb, flash_kb))

        # 型号字符串必须是 CW32 打头才算真读到了签名区（防深度休眠/错地址出的假数据）
        if not model.startswith('CW32'):
            out_json({'ok': False, 'error': 'bad_signature',
                      'hint': '签名区型号读出异常（%r）——芯片可能在深度休眠（UM §23.8 DAP 停摆）'
                              '或接线不稳，重试一次；若持续出现请反馈日志' % model})
            sys.exit(0)

        family = model[:8] if model.startswith(KNOWN_PREFIXES) else model
        matched = any(model.startswith(p) for p in KNOWN_PREFIXES)

        out_json({
            'ok': True,
            'model': model,
            'family': family,
            'vendor': 'WHXY',
            'uid': uid,
            'uid_length': UID_LEN,
            'cpuid': '0x%08X' % cpuid,
            'idcode': '0x%08X' % (idcode or 0),
            'pin_count': pin_count,
            'sram_kb': sram_kb,
            'flash_kb': flash_kb,
            'matched_table': matched,
        })
    except Exception as e:
        log('[ERR] read failed: %s' % e)
        out_json({'ok': False, 'error': 'read_failed',
                  'hint': 'SWD 读取失败：%s（原始报错: %s）' % (friendly_error(e), e)})
    finally:
        try:
            session.close()
        except Exception:
            pass


if __name__ == '__main__':
    main()

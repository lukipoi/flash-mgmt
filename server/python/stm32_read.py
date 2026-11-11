#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
stm32_read.py — STM32 / GD32 芯片 SWD 信息读取（只读 identify）【STM32 专属】

架构：
  传输层：pyOCD（CMSIS-DAP = WCH-LinkE DAP 模式，免驱）
  目标：generic cortex_m（attach 模式，不打扰运行中的芯片）
  识别：DBGMCU DEV_ID[11:0] → 家族表 → UID/Flash 容量地址（全部官方 RM 实锤，注明出处）
    - M3/M4 老家族（F1/F4）：DEV_IDCODE @ 0xE0042000
    - M0+/新家族（F0/G0/G4/L4/H7...）：DBG_IDCODE @ 0x40015800（自动回退）
  UID 未收录家族不猜地址，只报 DEV_ID（需查对应 RM 补表）。

GD32F10x 与 STM32F1 布局/DEV_ID 兼容（0x410），走同一分支。

前置：WCH-LinkE 处于 DAP 模式（API 层已做模式保险）。
接线：SWDIO(PA13) / SWCLK(PA14) / GND / 3V3。

stdout 只输出最终 JSON；过程日志全走 stderr（ASCII）。
"""

import sys
import os
import json
import logging

logging.getLogger('pyocd').setLevel(logging.WARNING)
logging.basicConfig(level=logging.WARNING)

# DBGMCU_IDCODE 候选地址（按序尝试）
PID_ADDRS = [0xE0042000, 0x40015800]

# 家族表：DEV_ID → (家族名, UID 地址, UID 长度, Flash 容量地址)
# 全部官方 RM 实锤（每条注明出处）；凭记忆的条目一律不收——ST 各子家族布局不一致已被实锤打脸
# RM0008 Rev21 §30/§31.6.1（F1）；RM0090 Rev22 §38.6.1/§39（F405/407 系）
FAMILIES = {
    0x412: ('STM32F101/103 低容量', 0x1FFFF7E8, 12, 0x1FFFF7E0),   # RM0008
    0x410: ('STM32F101/103 中容量', 0x1FFFF7E8, 12, 0x1FFFF7E0),   # RM0008（F103C8T6 在此；GD32F103 同）
    0x414: ('STM32F101/103 高容量', 0x1FFFF7E8, 12, 0x1FFFF7E0),   # RM0008（注意 0x414 是 F1 高容量！）
    0x430: ('STM32F10x XL密度', 0x1FFFF7E8, 12, 0x1FFFF7E0),       # RM0008
    0x418: ('STM32F105/107 互联型', 0x1FFFF7E8, 12, 0x1FFFF7E0),   # RM0008
    0x413: ('STM32F405/407/415/417', 0x1FFF7A10, 12, 0x1FFF7A22),  # RM0090（UID 基地址 0x1FFF7A10！非 7A18）
    0x419: ('STM32F42x/43x', 0x1FFF7A10, 12, 0x1FFF7A22),          # RM0090
    0x443: ('STM32C011xx', 0x1FFF7550, 12, 0x1FFF75A0),            # RM0490 Rev6 Table 178（C011 实测 DEV_ID 吻合）
    0x453: ('STM32C031xx', 0x1FFF7550, 12, 0x1FFF75A0),            # RM0490 Rev6 Table 178
    0x44C: ('STM32C051xx', 0x1FFF7550, 12, 0x1FFF75A0),            # RM0490 Rev6 Table 178
    0x444: ('STM32F030x4/x6', 0x1FFFF7AC, 12, 0x1FFFF7CC),         # RM0360 Table 110（F030F4P6 实测 DEV_ID 吻合；UID/容量真机实证）
    0x466: ('STM32G0', 0x1FFF7590, 12, 0x1FFF75E0),                # RM0454：G0 全系 DEV_ID=0x466（G030F6P6 真机实测 DBG_IDCODE=0x01001466 @0x40015800）；UID/容量 = ST 官方 HAL 头文件实锤（UID_BASE 0x1FFF7590 / FLASHSIZE_BASE 0x1FFF75E0，低16位=KB）
    0x445: ('STM32F070x6', 0x1FFFF7AC, 12, 0x1FFFF7CC),            # RM0360 Table 110
    0x440: ('STM32F030x8', 0x1FFFF7AC, 12, 0x1FFFF7CC),            # RM0360 Table 110
    0x448: ('STM32F070xB', 0x1FFFF7AC, 12, 0x1FFFF7CC),            # RM0360 Table 110
    0x064: ('PY32F002B', 0x1FFF0000, 16, None),                    # Puya PY32F002B RM V1.1 §4.3：UID 16B 基址 0x1FFF0000（布局同 002A：Lot ASCII+Wafer+坐标+偏移12固定0x78）；DEV_ID=0x064 实测自 PY32F002BF15P6TU 真机（DBG_IDCODE=0x60028004）；无 Flash 密度寄存器（容量报 None）
}

# Puya PY32（B 系新 die，有 DEV_ID）：命中这些 DEV_ID 时厂商报 Puya 而非 ST
PY32_DEV_IDS = {0x064}


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
    log('[INFO] STM32 SWD reader start (pyocd CMSIS-DAP)')

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
        # ---- DEV_ID：按序尝试两个 DBGMCU_IDCODE 地址（M3/M4 与 M0+/新家族不同）----
        pid = 0
        used_addr = None
        for addr in PID_ADDRS:
            try:
                v = target.read32(addr)
                log('[INFO] DBG_IDCODE @0x%08X = 0x%08X' % (addr, v))
                if v and v != 0xFFFFFFFF:   # 任何非零非错误值都接受（PY32 的 DEV_ID 位=0）
                    pid = v
                    used_addr = addr
                    break
            except Exception:
                continue
        if not pid:
            out_json({'ok': False, 'error': 'no_device',
                      'hint': '两个 DBGMCU_IDCODE 地址均无有效应答（确认 SWD 四线、芯片上电、未被 SWD 锁）'})
            sys.exit(0)

        dev_id = pid & 0xFFF          # DEV_ID[11:0]（RM 定义）
        rev_id = (pid >> 16) & 0xFFFF
        log('[INFO] DEV_ID=0x%03X REV_ID=0x%04X (via 0x%08X)' % (dev_id, rev_id, used_addr))

        # ---- PY32（Puya 老 die 特征码识别）：DBG_IDCODE bits[11:0]=0（DEV_ID 缺席）----
        # 特征：UID @0x1FFF0E00（16B），偏移 12 固定 0x78（PY32F003 RM V1.1 §4.3 / PY32F002A 同布局）
        # PY32F002A 与 PY32F003 均为老 die（DEV_ID=0）、UID 布局/基址相同，仅凭 UID 无法区分，
        # 型号报 'PY32F003/002A'，由录入时人工确认；若真机报出非 0 DEV_ID 再按 002B 流程补家族表
        if dev_id == 0 and pid:
            try:
                uid16 = read_uid_verified(target, 0x1FFF0E00, 16, 'PY32 UID16')
                if uid16[12] == 0x78:
                    log('[INFO] PY32 特征码命中（UID[12]=0x78）')
                    log('[INFO] UID: %s' % uid16.hex().upper())
                    out_json({
                        'ok': True,
                        'model': 'PY32F003/002A',
                        'vendor': 'Puya',
                        'uid': uid16.hex().upper(),
                        'uid_length': 16,
                        'dev_id': '0x000',
                        'rev_id': '0x%04X' % rev_id,
                        'matched_table': False,
                    })
                    sys.exit(0)
            except Exception:
                pass

        # ---- 家族表 ----
        if dev_id not in FAMILIES:
            log('[WARN] 未收录家族（DEV_ID=0x%03X），需查对应 RM 补表' % dev_id)
            out_json({
                'ok': True,
                'model': 'STM32(DEV_ID=0x%03X)' % dev_id,
                'vendor': 'ST',
                'uid': '',
                'uid_length': 0,
                'dev_id': '0x%03X' % dev_id,
                'rev_id': '0x%04X' % rev_id,
                'matched_table': False,
            })
            sys.exit(0)

        family, uid_addr, uid_len, size_addr = FAMILIES[dev_id]
        vendor = 'Puya' if dev_id in PY32_DEV_IDS else 'ST'

        # ---- Flash 容量（无密度寄存器的家族报 None）----
        flash_kb = None
        try:
            if size_addr:
                flash_kb = int.from_bytes(target.read_memory_block8(size_addr, 2), 'little')
        except Exception:
            pass

        # ---- UID 96bit（双读校验）----
        uid_bytes = read_uid_verified(target, uid_addr, uid_len, family + ' UID')
        uid = bytes(uid_bytes).hex().upper()
        log('[INFO] family: %s' % family)
        log('[INFO] flash: %s KB' % flash_kb)
        log('[INFO] UID: %s' % uid)

        out_json({
            'ok': True,
            'model': family,
            'vendor': vendor,
            'uid': uid,
            'uid_length': uid_len,
            'dev_id': '0x%03X' % dev_id,
            'rev_id': '0x%04X' % rev_id,
            'flash_kb': flash_kb,
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

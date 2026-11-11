#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gd32_read.py — GigaDevice GD32 系列 SWD 信息读取（只读 identify）【GD32 专属通道】

架构：
  传输层：pyOCD（CMSIS-DAP = WCH-LinkE DAP 模式，免驱）
  目标：generic cortex_m（attach 模式，不打扰运行中的芯片）
  识别：DBG_IDCODE → DEV_ID[11:0] → 家族表 → UID/Flash 容量地址
    - GD32E23x（M23）：DBG base = 0x40015800（ID code 寄存器 @ offset 0x00）
    - UID 96bit @ 0x1FFFF7AC（三 32-bit 字 0x1FFFF7AC / 0x1FFFF7B0 / 0x1FFFF7B4）
    - Flash/SRAM 密度 @ 0x1FFFF7E0（低 16 位 = Flash KB；高 16 位 = SRAM KB）

拆分原因（关键）：
  GD32E230 与 STM32F103 / GD32F103 同为 DEV_ID = 0x410，但 UID 地址不同：
    - GD32E230（M23）：UID @ 0x1FFFF7AC
    - STM32F1 / GD32F103（M3）：UID @ 0x1FFFF7E8
  合并通道下 0x410 只能命中一条 UID 地址，会读出乱码；故独立出 GD32 通道，
  使用 E23x 专属地址。F1 兼容的 GD32F103 仍留在 STM32 通道（同 0x410 + 0x1FFFF7E8）。

  GD32E23x 各子型号（C8/E8/F8/G8/K8...）共用同一 DEV_ID 0x410 与同一电子签名布局，
  仅 Flash/SRAM 密度不同（由 0x1FFFF7E0 读出），故无需按子型号建表。

GD32E23x User Manual Rev2.5 §1.6（电子签名）/ §9.4（DBG）实锤。
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

# DBG_IDCODE 候选地址（按序尝试）
#  GD32E23x (M3 Cortex-M23): 0x40015800  —— E23x DBG base（SVD / UM §9.4 实锤）
#  GD32F1x0/F3x0 (M3/M4):   0xE0042000  —— 与 STM32F1 同（F1 兼容件若错选本通道可兜底）
PID_ADDRS = [0x40015800, 0xE0042000]

# 家族表：DEV_ID → (家族名, UID 地址, UID 长度, Flash 容量地址)
# 全部官方 RM 实锤；凭记忆的条目一律不收
#  GD32E230: OpenOCD gd32exxx 驱动确认 DEV_ID=0x410（GD32E230x8）；
#            UID @0x1FFFF7AC（UM §1.6.2），密度 @0x1FFFF7E0（UM §1.6.1，低16位=Flash KB）
FAMILIES = {
    0x410: ('GD32E230', 0x1FFFF7AC, 12, 0x1FFFF7E0),
}


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
    log('[INFO] GD32 SWD reader start (pyocd CMSIS-DAP)')

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
        # ---- DEV_ID：按序尝试 DBG_IDCODE 候选地址（GD32 各家族 DBG base 不同）----
        pid = 0
        used_addr = None
        for addr in PID_ADDRS:
            try:
                v = target.read32(addr)
                log('[INFO] DBG_IDCODE @0x%08X = 0x%08X' % (addr, v))
                if v and v != 0xFFFFFFFF:   # 任何非零非错误值都接受
                    pid = v
                    used_addr = addr
                    break
            except Exception:
                continue
        if not pid:
            out_json({'ok': False, 'error': 'no_device',
                      'hint': 'DBG_IDCODE 候选地址均无有效应答（确认 SWD 四线、芯片上电、未被 SWD 锁）'})
            sys.exit(0)

        dev_id = pid & 0xFFF          # DEV_ID[11:0]（RM 定义）
        rev_id = (pid >> 16) & 0xFFFF
        log('[INFO] DEV_ID=0x%03X REV_ID=0x%04X (via 0x%08X)' % (dev_id, rev_id, used_addr))

        # ---- 家族表 ----
        if dev_id not in FAMILIES:
            log('[WARN] 未收录 GD32 家族（DEV_ID=0x%03X），需查对应 RM 补表' % dev_id)
            out_json({
                'ok': True,
                'model': 'GD32(DEV_ID=0x%03X)' % dev_id,
                'vendor': 'GigaDevice',
                'uid': '',
                'uid_length': 0,
                'dev_id': '0x%03X' % dev_id,
                'rev_id': '0x%04X' % rev_id,
                'flash_kb': None,
                'matched_table': False,
            })
            sys.exit(0)

        family, uid_addr, uid_len, size_addr = FAMILIES[dev_id]

        # ---- Flash 容量（低 16 位 = KB，UM §1.6.1）----
        flash_kb = None
        try:
            raw = target.read_memory_block8(size_addr, 2)
            flash_kb = int.from_bytes(raw, 'little')
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
            'vendor': 'GigaDevice',
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

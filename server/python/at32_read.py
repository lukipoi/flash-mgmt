#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
at32_read.py — AT32 芯片 SWD 信息读取（只读 identify）【AT32 专属，勿混用其他家族】

架构：
  传输层：pyOCD（CMSIS-DAP = WCH-LinkE DAP 模式，免驱）
  目标：generic cortex_m（attach 模式，不打扰运行中的芯片）
  识别算法：Artery 官方 AN0016《Recognize AT32 MCU》——
    PID        = u32 @ 0xE0042000（DBGMCU_IDCODE）
    系列字节   = u8  @ 0x1FFFF7F3（UID 区末尾）
    AT_device_id = (系列字节 << 32) | PID   →  查 at32IdTable.json（官方映射，66 条）
    UID        = 96bit @ 0x1FFFF7E8（12 字节）
  型号表缺失时仍输出 UID + id64，可人工建档。

前置：WCH-LinkE 必须处于 DAP 模式（服务端 API 已做模式保险自动切换）。
接线：SWDIO(PA13) / SWCLK(PA14) / GND / 3V3，随时可读、无需断电重启、无需 halt。

注意：0x1FFFF7F3/0x1FFFF7E8 是 AT32 布局，STM32 上不可读——STM32 用 stm32_read.py。

stdout 只输出最终 JSON；过程日志全走 stderr（ASCII）。
"""

import sys
import os
import json
import logging

logging.getLogger('pyocd').setLevel(logging.WARNING)
logging.basicConfig(level=logging.WARNING)

UID_ADDR = 0x1FFFF7E8     # AT32 全系列 UID 96bit 基地址（AN0016）
UID_LEN = 12
PID_ADDR = 0xE0042000     # DBGMCU_IDCODE / PID
PART_ADDR = 0x1FFFF7F3    # 系列型号字节
ID_TABLE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'utils', 'at32IdTable.json')


def log(msg):
    print(msg, file=sys.stderr)
    sys.stderr.flush()


def out_json(obj):
    print(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()


def load_id_table():
    try:
        with open(ID_TABLE, encoding='utf-8') as f:
            return {c['id'].upper(): c for c in json.load(f)['chips']}
    except Exception as e:
        log('[WARN] id table load failed: %s' % e)
        return {}


def main():
    log('[INFO] AT32 SWD reader start (pyocd CMSIS-DAP)')

    # ---- 找探针 ----
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

    # ---- 附加目标 ----
    from pyocd.core.session import Session   # pyocd 0.44+：Session 在 core 下
    try:
        session = Session(probe, target_override='cortex_m')
        session.open()
    except Exception as e:
        out_json({'ok': False, 'error': 'attach_failed',
                  'hint': 'SWD 附加失败: %s（确认 SWDIO/SWCLK/GND/3V3 四线、芯片已上电、LinkE 为 DAP 模式）' % e})
        sys.exit(0)

    target = session.target
    try:
        # ---- AN0016 识别 ----
        pid = target.read32(PID_ADDR)
        dev_id = pid & 0xFFF          # DEV_ID[11:0]（RM 定义）
        rev_id = (pid >> 16) & 0xFFFF
        log('[INFO] PID=0x%08X DEV_ID=0x%03X REV_ID=0x%04X' % (pid, dev_id, rev_id))

        part = target.read8(PART_ADDR)
        id64 = ((part << 32) | pid) & 0xFFFFFFFFFFFFFFFF
        id64_hex = '0x%016X' % id64
        log('[INFO] AT_device_id = %s' % id64_hex)

        table = load_id_table()
        hit = table.get(id64_hex.upper())   # 表 key 已 upper（0X 前缀）
        model = hit['model'] if hit else 'AT32(未收录 %s)' % id64_hex
        flash_kb = hit['flash_kb'] if hit else None
        package = hit['package'] if hit else None
        matched = bool(hit)
        log('[INFO] model: %s' % model)

        # ---- UID 96bit ----
        uid_bytes = target.read_memory_block8(UID_ADDR, UID_LEN)
        uid = bytes(uid_bytes).hex().upper()
        log('[INFO] UID: %s' % uid)

        out_json({
            'ok': True,
            'model': model,
            'vendor': 'Artery' if matched else None,
            'uid': uid,
            'uid_length': UID_LEN,
            'id64': id64_hex,
            'dev_id': '0x%03X' % dev_id,
            'rev_id': '0x%04X' % rev_id,
            'flash_kb': flash_kb,
            'package': package,
            'matched_table': matched,
        })
    except Exception as e:
        out_json({'ok': False, 'error': 'read_failed',
                  'hint': 'SWD 读取失败: %s（确认四线接触良好、芯片为 AT32 且未锁 SWD、已上电）' % e})
    finally:
        try:
            session.close()
        except Exception:
            pass


if __name__ == '__main__':
    main()

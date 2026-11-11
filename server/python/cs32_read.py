#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cs32_read.py — Chipsea 芯海 CS32 系列 SWD 信息读取（只读 identify）【CS32 专属通道】

架构：
  传输层：pyOCD（CMSIS-DAP = WCH-LinkE DAP 模式，免驱）
  目标：generic cortex_m（attach 模式，不打扰运行中的芯片）
  识别：DBG_ID → DEV_ID[11:0] → 家族表 → UID/Flash 容量地址
    - DBG_ID @ 0x40015800（DBG base，偏移 0x000）
    - DEV_ID = 0x444 —— 真机实测（CS32F035F6P7）DBG_ID=0x10006444，与 STM32F0 完全同款！
      （UM §24.3.2 写复位值 0x1000644X，末位 X 为通配；此前误读为 DEV_ID=0x644，真机纠正）
      独立通道保留原因：不依赖 STM32 通道的家族表，且为芯海其他家族（F03X-RA/G/A 系列）
      未来可能出现不同 DEV_ID 预留位置
    - UID 96bit @ 0x1FFFF7AC（12 字节：[31:0] LOT 信息 / [63:32] Wafer+芯片型号 / [95:64] 芯片位置）
    - FLASH_SIZE @ 0x1FFFF7CC（低 16 位 = Flash KB）

来源实锤（CS32F03x 用户手册 中文 REV1.1，543 页，官方 OBS 直链 + CS32F035F6P7 真机）：
  §24.3.2 DBG_ID（0x40015800，复位值 0x1000644X；真机实测 0x10006444 → DEV_ID=0x444）
  §25.2 器件唯一身份标识寄存器（UID）基地址 0x1FFFF7AC（96 位）
  §25.3 Flash 大小寄存器（FLASH_SIZE）基地址 0x1FFFF7CC（低 16 位 = KB）
  注：本 UM 覆盖 CS32F03x 全系（F030/F031/F035/F036）；其他 CS32 家族
      （F0XX-RA、G 系列、A 系列…）DEV_ID 未知，读到后报值待补表。

前置：WCH-LinkE 处于 DAP 模式（API 层已做模式保险）。
接线：SWDIO(PA13) / SWCLK(PA14) / GND / 3V3（SWD 复用脚，详见 UM「flash读写保护和SWD复用」AN）。

stdout 只输出最终 JSON；过程日志全走 stderr（ASCII）。
"""

import sys
import json
import logging

logging.getLogger('pyocd').setLevel(logging.WARNING)
logging.basicConfig(level=logging.WARNING)

DBG_ID_ADDR = 0x40015800

# 家族表：DEV_ID → (家族名, UID 地址, UID 长度, Flash 容量地址)
# DEV_ID=0x444 为真机实锤（CS32F035F6P7 DBG_ID=0x10006444）；UID/容量地址 UM §25.2/§25.3 实锤
FAMILIES = {
    0x444: ('CS32F03x', 0x1FFFF7AC, 12, 0x1FFFF7CC),
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
    log('[INFO] CS32 SWD reader start (pyocd CMSIS-DAP)')

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
        # ---- DBG_ID（CS32F03x DBG base = 0x40015800，UM §24.3.2）----
        try:
            pid = target.read32(DBG_ID_ADDR)
        except Exception as e:
            log('[ERR] DBG_ID read failed: %s' % e)
            out_json({'ok': False, 'error': 'no_device',
                      'hint': 'DBG_ID 无应答（确认 SWD 四线、芯片上电、未被 SWD 锁；'
                              '若芯片配置了 flash 读写保护/SWD 复用需先解锁，见芯海 AN）'})
            sys.exit(0)
        log('[INFO] DBG_ID @0x%08X = 0x%08X' % (DBG_ID_ADDR, pid))
        if not pid or pid == 0xFFFFFFFF:
            out_json({'ok': False, 'error': 'no_device',
                      'hint': 'DBG_ID 无有效应答（确认 SWD 四线、芯片上电）'})
            sys.exit(0)

        dev_id = pid & 0xFFF          # DEV_ID[11:0]（UM §24.3.2）
        rev_id = (pid >> 16) & 0xFFFF
        log('[INFO] DEV_ID=0x%03X REV_ID=0x%04X' % (dev_id, rev_id))

        # ---- 家族表 ----
        if dev_id not in FAMILIES:
            log('[WARN] 未收录 CS32 家族（DEV_ID=0x%03X），需查对应 UM 补表' % dev_id)
            out_json({
                'ok': True,
                'model': 'CS32(DEV_ID=0x%03X)' % dev_id,
                'vendor': 'Chipsea',
                'uid': '',
                'uid_length': 0,
                'dev_id': '0x%03X' % dev_id,
                'rev_id': '0x%04X' % rev_id,
                'flash_kb': None,
                'matched_table': False,
            })
            sys.exit(0)

        family, uid_addr, uid_len, size_addr = FAMILIES[dev_id]

        # ---- Flash 容量（低 16 位 = KB，UM §25.3）----
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
            'vendor': 'Chipsea',
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

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
apm32_read.py — Geehy 极海 APM32 系列 SWD 信息读取（只读 identify）【APM32 专属通道】

架构：
  传输层：pyOCD（CMSIS-DAP = WCH-LinkE DAP 模式，免驱）
  目标：generic cortex_m（attach 模式，不打扰运行中的芯片）
  识别：CPUID 诊断 + 电子签名区直读（不依赖 DEV_ID）
    - 极海官方 UM/DS 均不提供 DBG_IDCODE/DEV_ID 实锤（UM/DS grep 零命中，
      OpenOCD 官方 APM32 patch 也是用 CPUID partno=M0+ 识别 F003 而非 DEV_ID）
    - 故本读取器直接读电子签名区（地址三源实锤），DBG_ID 候选值仅记录不做门槛

签名区实锤（APM32F003x4x6 用户手册 V1.7 §20 + 数据手册 V2.4 + OpenOCD patch + CSDN 同型号实测）：
  - 系统存储区 0x0002 0000 - 0x0002 03FF（1KB，出厂写入，用户只读）
  - F_SIZE（闪存容量，16 位，单位 KB）@ 0x0002 03E0（例 0x0020 = 32KB；OpenOCD patch 同址 u16 读）
  - UID 96bit（12 字节）@ 0x0002 03E4（UM 只写"偏移 0x04/0x08/0x0C"未给基址；
    CSDN 博主在 APM32F003F6P6 同型号上翻 FLASH 实测 0x000203E4 = F_SIZE 基址+0x04，与 UM 偏移吻合）
  - 本 UM 覆盖 APM32F003x4/x6 全系（F4xx 16KB / F6xx 32KB），签名区布局系列共用

前置：WCH-LinkE 处于 DAP 模式（API 层已做模式保险）。
接线：SWD 四线（SWDIO/SWCLK/GND/3V3）。

stdout 只输出最终 JSON；过程日志全走 stderr（ASCII）。
"""

import sys
import json
import logging

logging.getLogger('pyocd').setLevel(logging.WARNING)
logging.basicConfig(level=logging.WARNING)

CPUID_ADDR = 0xE000ED00

# 电子签名区（APM32F003x4x6 UM V1.7 §20 实锤 + OpenOCD patch + 同型号实测）
F_SIZE_ADDR = 0x000203E0    # 16 位，KB
UID_ADDR = 0x000203E4       # 96bit = F_SIZE 基址 + 0x04（UM 偏移字段 0x04/0x08/0x0C）
UID_LEN = 12

# DBG_IDCODE 候选（仅记录诊断用，不做家族门槛；官方无 DEV_ID 实锤）
# 真机实测（APM32F003F6P6）：读 0x40015800 直接 Memory transfer fault（FAULT ACK）
# —— 该芯片无 STM32F0 式 DBGMCU_IDCODE 寄存器映射，DEV_ID 这条路彻底不存在
DBG_ID_ADDR = 0x40015800


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
    log('[INFO] APM32 SWD reader start (pyocd CMSIS-DAP)')

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
        # ---- CPUID 诊断（M0+ 预期 partno=0xC60）----
        cpuid = 0
        try:
            cpuid = target.read32(CPUID_ADDR)
            part = (cpuid >> 4) & 0xFFF
            log('[INFO] CPUID @0x%08X = 0x%08X (partno=0x%03X, M0+ expect 0xC60)'
                % (CPUID_ADDR, cpuid, part))
        except Exception as e:
            log('[WARN] CPUID read failed: %s' % e)
        if not cpuid or cpuid == 0xFFFFFFFF:
            out_json({'ok': False, 'error': 'no_device',
                      'hint': 'CPUID 无有效应答（确认 SWD 四线、芯片上电、未被 SWD 锁）'})
            sys.exit(0)

        # ---- DBG_IDCODE 候选（仅记录；极海官方无 DEV_ID 实锤）----
        dev_id = 0
        rev_id = 0
        try:
            pid = target.read32(DBG_ID_ADDR)
            if pid and pid != 0xFFFFFFFF:
                dev_id = pid & 0xFFF
                rev_id = (pid >> 16) & 0xFFFF
                log('[INFO] DBG_IDCODE @0x%08X = 0x%08X (DEV_ID=0x%03X REV_ID=0x%04X)'
                    % (DBG_ID_ADDR, pid, dev_id, rev_id))
        except Exception as e:
            log('[INFO] DBG_IDCODE read skipped: %s' % e)

        # ---- 电子签名区（系统存储区 0x0002 0000-0x03FF，UM §20，双读校验）----
        uid_bytes = read_uid_verified(target, UID_ADDR, UID_LEN, 'APM32 UID')
        uid = uid_bytes.hex().upper()
        log('[INFO] UID(%dB) @0x%08X: %s' % (UID_LEN, UID_ADDR, uid))

        if uid in ('', 'FF' * UID_LEN, '00' * UID_LEN):
            out_json({'ok': False, 'error': 'bad_signature',
                      'hint': '系统存储区 UID 读出全空（%s）——核对地址映射或接线；'
                              '若持续出现请反馈日志' % uid})
            sys.exit(0)

        flash_kb = None
        try:
            raw = target.read_memory_block8(F_SIZE_ADDR, 2)
            flash_kb = int.from_bytes(raw, 'little')
        except Exception as e:
            log('[WARN] F_SIZE read failed: %s' % e)
        log('[INFO] flash: %s KB (F_SIZE @0x%08X)' % (flash_kb, F_SIZE_ADDR))

        out_json({
            'ok': True,
            'model': 'APM32F003',
            'vendor': 'Geehy',
            'uid': uid,
            'uid_length': UID_LEN,
            'cpuid': '0x%08X' % cpuid,
            'dev_id': ('0x%03X' % dev_id) if dev_id else '',
            'rev_id': ('0x%04X' % rev_id) if rev_id else '',
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

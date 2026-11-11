#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
apm32_dump.py — APM32F003 系统存储区（电子签名区）一次性 dump 诊断

用途：核查 UID @0x000203E4 / F_SIZE @0x000203E0 地址正确性。
  1) hexdump 整个系统存储区 0x0002 0000 - 0x0002 03FF（1KB）
  2) UID 区（0x000203E0 - 0x000203EF）双读对比（HK32 教训：查易失/漂移）
  3) 字读 vs 字节读交叉验证

用法：python apm32_dump.py   （WCH-LinkE DAP 模式 + SWD 四线已接）
stdout 输出 hexdump 与结论；stderr 走过程日志。
"""

import sys

F_SIZE_ADDR = 0x000203E0
UID_ADDR = 0x000203E4
BASE = 0x00020000
SIZE = 0x400   # 1KB 系统存储区


def log(msg):
    print(msg, file=sys.stderr)
    sys.stderr.flush()


def hexdump(data, base):
    for off in range(0, len(data), 16):
        chunk = data[off:off + 16]
        hexs = ' '.join('%02X' % b for b in chunk)
        asc = ''.join(chr(b) if 0x20 <= b < 0x7F else '.' for b in chunk)
        print('%08X  %-47s  |%s|' % (base + off, hexs, asc))


def main():
    from pyocd.probe.aggregator import DebugProbeAggregator
    probes = DebugProbeAggregator.get_all_connected_probes()
    if not probes:
        print('未检测到探针')
        sys.exit(1)
    probe = next((p for p in probes if 'wch' in (p.vendor_name or '').lower()), probes[0])
    log('probe: %s %s' % (probe.vendor_name, probe.product_name))

    from pyocd.core.session import Session
    session = Session(probe, target_override='cortex_m')
    session.open()
    target = session.target
    try:
        cpuid = target.read32(0xE000ED00)
        log('CPUID = 0x%08X' % cpuid)

        # 1) 整区 dump
        block = bytes(target.read_memory_block8(BASE, SIZE))
        print('\n===== 系统存储区 dump 0x%08X - 0x%08X =====' % (BASE, BASE + SIZE - 1))
        hexdump(block, BASE)

        # 2) UID 区双读对比（间隔再读一次，查漂移）
        print('\n===== UID/F_SIZE 区双读稳定性 =====')
        for i in (1, 2):
            chunk = bytes(target.read_memory_block8(0x000203E0, 16))
            print('read#%d @0x000203E0: %s' % (i, chunk.hex().upper()))

        # 3) 字读 vs 字节读交叉验证（UID 前两字）
        print('\n===== 字读 vs 字节读 交叉验证 =====')
        b = bytes(target.read_memory_block8(UID_ADDR, 8))
        w0 = target.read32(UID_ADDR)
        w1 = target.read32(UID_ADDR + 4)
        print('byte read: %s' % b.hex().upper())
        print('word read: %08X %08X' % (w0, w1))
        ok0 = int.from_bytes(b[0:4], 'little') == w0
        ok1 = int.from_bytes(b[4:8], 'little') == w1
        print('match: word0=%s word1=%s' % (ok0, ok1))
    finally:
        try:
            session.close()
        except Exception:
            pass


if __name__ == '__main__':
    main()

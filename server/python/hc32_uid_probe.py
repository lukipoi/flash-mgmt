#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
hc32_uid_probe.py — HC32L110 / HC32F005 UID 区读取行为专项探针

前提：VCAP（TSSOP20 pin8）已接 4.7uF（或 0.1uF）电容到 GND——悬空必污染。
实验组：
  A) 连续 10 次 byte 读 10B @0x00100E74（同会话重复性，唯一结果数是关键）
  B) 不同长度 byte 读 @0x00100E70（1/2/4/8/10/16/64B，看长读是否开始污染）
  C) word 读（u32）@0x00100E70/74/78/7C ×3 轮
  D) 半字读（u16）×3 轮
  E) 重开会话（session close→open）后再读 10B（跨会话稳定性）
用法：python hc32_uid_probe.py
"""

import sys
import time

WINDOW_ADDR = 0x00100E70
UID_ADDR = 0x00100E74
UID_LEN = 10


def log(msg):
    print(msg, file=sys.stderr)
    sys.stderr.flush()


def main():
    from pyocd.probe.aggregator import DebugProbeAggregator
    probes = DebugProbeAggregator.get_all_connected_probes()
    if not probes:
        print('未检测到探针')
        sys.exit(1)
    probe = next((p for p in probes if 'wch' in (p.vendor_name or '').lower()), probes[0])
    log('probe: %s %s' % (probe.vendor_name, probe.product_name))

    from pyocd.core.session import Session

    def read_bytes(target, addr, n):
        try:
            return bytes(target.read_memory_block8(addr, n)).hex().upper()
        except Exception as e:
            return 'ERR:%s' % e

    def open_session():
        s = Session(probe, target_override='cortex_m')
        s.open()
        return s

    session = open_session()
    target = session.target

    try:
        cpuid = target.read32(0xE000ED00)
        log('CPUID = 0x%08X' % cpuid)

        # ---- A) 同会话连续 10 次 byte 读 10B ----
        print('===== A) 同会话连续 10 次 byte 读 %dB @0x%08X =====' % (UID_LEN, UID_ADDR))
        seen = {}
        for i in range(10):
            r = read_bytes(target, UID_ADDR, UID_LEN)
            seen[r] = seen.get(r, 0) + 1
            print('  #%02d: %s' % (i + 1, r))
            time.sleep(0.05)
        print('  唯一结果数: %d' % len(seen))
        for k, v in sorted(seen.items(), key=lambda x: -x[1]):
            print('    %s ×%d' % (k, v))

        # ---- B) 不同长度读（起 @窗口基址）----
        print('===== B) 不同长度 byte 读（均起 @0x%08X）=====' % WINDOW_ADDR)
        for n in (1, 2, 4, 8, 10, 16, 64):
            r = read_bytes(target, WINDOW_ADDR, min(n, 16))
            suffix = '' if n <= 16 else '（%dB 大块，只显示前 16B）' % n
            print('  %-3dB: %s%s' % (n, r, suffix))

        # ---- C) word 读 ----
        print('===== C) word 读（u32，重复 3 轮）=====')
        for addr in (0x00100E70, 0x00100E74, 0x00100E78, 0x00100E7C):
            vals = []
            for _ in range(3):
                try:
                    vals.append('%08X' % target.read32(addr))
                except Exception:
                    vals.append('ERR')
            print('  @0x%08X: %s' % (addr, ' '.join(vals)))

        # ---- D) 半字读 ----
        print('===== D) 半字读（u16，重复 3 轮）=====')
        for addr in (0x00100E74, 0x00100E76, 0x00100E78, 0x00100E7A):
            vals = []
            for _ in range(3):
                try:
                    vals.append('%04X' % target.read16(addr))
                except Exception:
                    vals.append('ERR')
            print('  @0x%08X: %s' % (addr, ' '.join(vals)))

        # ---- E) 跨会话稳定性 ----
        print('===== E) 重开会话后再读（跨会话稳定性）=====')
        for i in (1, 2):
            try:
                session.close()
            except Exception:
                pass
            time.sleep(0.3)
            session = open_session()
            target = session.target
            print('  session#%d: %s' % (i, read_bytes(target, UID_ADDR, UID_LEN)))
    finally:
        try:
            session.close()
        except Exception:
            pass


if __name__ == '__main__':
    main()

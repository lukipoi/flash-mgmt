#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
apm32_uid_probe.py — APM32F003 UID 区读取行为专项探针

背景：dump 发现 0x000203E4 UID 区读数与「读取方式」强相关——
  byte 12B 读跨会话复现一致，1KB 大块读 / 16B 读 / word 读却吐出不同内容。
本脚本做五组对照实验，分辨哪些字节是真 UID、什么读法才可靠：
  A) 连续 10 次 byte 读 12B @0x203E4（同会话重复性）
  B) 1B / 2B / 4B / 8B / 12B / 16B / 1KB 不同长度读，对比结果
  C) word 读 @0x203E0 / 0x203E4 / 0x203E8 / 0x203EC（对齐 32 位访问行为）
  D) 半字读（u16）同上
  E) 重开会话（session close→open）后再读 12B（跨会话稳定性）

用法：python apm32_uid_probe.py
"""

import sys
import time

UID_ADDR = 0x000203E4


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
        # ---- A) 同会话连续 10 次 byte 读 12B ----
        print('===== A) 同会话连续 10 次 byte 读 12B @0x%08X =====' % UID_ADDR)
        seen = {}
        for i in range(10):
            r = read_bytes(target, UID_ADDR, 12)
            seen[r] = seen.get(r, 0) + 1
            print('  #%02d: %s' % (i + 1, r))
            time.sleep(0.05)
        print('  唯一结果数: %d' % len(seen))
        for k, v in seen.items():
            print('    %s ×%d' % (k, v))

        # ---- B) 不同长度读 ----
        print('===== B) 不同长度 byte 读（均起 @0x%08X）=====' % UID_ADDR)
        for n in (1, 2, 4, 8, 12, 16, 1024):
            r = read_bytes(target, UID_ADDR, min(n, 16))
            suffix = '' if n <= 16 else '（1KB 大块，只显示前 16B）'
            print('  %-4dB: %s%s' % (n, r, suffix))

        # ---- C) word（u32）读 ----
        print('===== C) word 读（u32，重复 3 轮）=====')
        for addr in (0x000203E0, 0x000203E4, 0x000203E8, 0x000203EC):
            vals = []
            for _ in range(3):
                try:
                    vals.append('%08X' % target.read32(addr))
                except Exception as e:
                    vals.append('ERR')
            print('  @0x%08X: %s' % (addr, ' '.join(vals)))

        # ---- D) 半字（u16）读 ----
        print('===== D) 半字读（u16，重复 3 轮）=====')
        for addr in (0x000203E4, 0x000203E6, 0x000203E8, 0x000203EA):
            vals = []
            for _ in range(3):
                try:
                    vals.append('%04X' % target.read16(addr))
                except Exception as e:
                    vals.append('ERR')
            print('  @0x%08X: %s' % (addr, ' '.join(vals)))

        # ---- E) 重开会话跨会话稳定性 ----
        print('===== E) 重开会话后再读（跨会话稳定性）=====')
        for i in (1, 2):
            try:
                session.close()
            except Exception:
                pass
            time.sleep(0.3)
            session = open_session()
            target = session.target
            print('  session#%d: %s' % (i, read_bytes(target, UID_ADDR, 12)))
    finally:
        try:
            session.close()
        except Exception:
            pass


if __name__ == '__main__':
    main()

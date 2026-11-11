#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
hk32_read.py — 航顺 HK32 系列 SWD 信息读取（只读 identify）【HK32 专属通道】

架构：
  传输层：pyOCD（CMSIS-DAP = WCH-LinkE DAP 模式，免驱）
  目标：generic cortex_m（attach 模式，不打扰运行中的芯片）

HK32F030M 关键差异（与 STM32 克隆表象不同，别被 F0 外皮骗了）：
  - DBGMCU @0x40015800（官方博客实锤：HK32F030 系 DBGMCU_IDCODE 与 ST 完全相同，
    即 STM32F0 式 DEV_ID/REV_ID 布局；HK32F04A 才不同）
  - UID 是 64 位（不是 ST 的 96 位！）：@0x1FFFF818 ~ 0x1FFFF81F（datasheet Rev1.3 图 3-2
    存储器映射信息块：F800-F817=24B 选项字，F818-F81F=64bit UID，其上=40B 出厂设置）
    注意：M 系信息块布局与 STM32F0 完全不同，UID 不在 0x1FFFF7AC！
    （A 系 HK32F030 才是 0x1FFFF7AC 布局，且社区实测手册写错——真 UID 基址=0x1FFFF7B0，
    AC 那个字全片相同。M 系没有这个坑，地址以图 3-2 为准。）
  - 16KB Flash / 2KB SRAM 为全系列固定规格（datasheet 表 2-1），无密度寄存器可读，
    flash_kb 直接报官方常量 16。
  - DEV_ID 实测值未知（首读采集后如与 ST 0x444 不同，在此记录）。

⚠️ 别用 STM32 通道读 HK32F030M：DEV_ID 若=0x444 会命中 STM32F0 家族表，
   从 0x1FFFF7AC 读 96 位——对 M 系是错地址。

前置：WCH-LinkE 处于 DAP 模式（API 层已做模式保险）。
接线：SWDIO/SWCLK/GND/3V3（SWDIO/SWCLK 具体引脚查 datasheet 第 6 章管脚定义，勿凭 STM32 习惯猜）。

stdout 只输出最终 JSON；过程日志全走 stderr（ASCII）。
"""

import sys
import json
import logging

logging.getLogger('pyocd').setLevel(logging.WARNING)
logging.basicConfig(level=logging.WARNING)

# DBG_IDCODE 候选地址（HK32F030 系与 ST 相同：M0 用 0x40015800；兜底 M3/M4 式 0xE0042000）
PID_ADDRS = [0x40015800, 0xE0042000]

# HK32F030M 固定规格（datasheet Rev1.3 表 2-1：全系列 16KB Flash / 2KB SRAM，仅封装不同）
FLASH_KB = 16
UID_ADDR = 0x1FFFF818   # 64-bit UID（图 3-2 信息块：0x1FFF_F818 ~ 0x1FFF_F81F）
UID_LEN = 8


def log(msg):
    print(msg, file=sys.stderr)
    sys.stderr.flush()


def out_json(obj):
    print(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()


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
    log('[INFO] HK32 SWD reader start (pyocd CMSIS-DAP)')

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
        # ---- 诊断：CPUID（M0 应为 0x410CC2xx），确认 core 读通路 ----
        try:
            cpuid = target.read32(0xE000ED00)
            log('[INFO] CPUID @0xE000ED00 = 0x%08X' % cpuid)
        except Exception as e:
            cpuid = None
            log('[WARN] CPUID 读取失败: %s' % e)

        # ---- DEV_ID：HK32F030 系 IDCODE 与 ST 相同（官方博客，A 系）；M 系实测可能全 0 ----
        # 实测（2026-11-06 HK32F030MF4P6 真机）：0x40015800 与 0xE0042000 均读出 0x00000000
        # —— M 系裸 die 的 DBG_IDCODE 整寄存器为 0（连 REV_ID 都是 0），DEV_ID 缺席。
        # 0 不是总线错误（那种是 0xFFFFFFFF 或抛异常），不能拒收，继续走 UID 识别。
        pid = 0
        used_addr = None
        for addr in PID_ADDRS:
            try:
                v = target.read32(addr)
                log('[INFO] DBG_IDCODE @0x%08X = 0x%08X' % (addr, v))
                if v != 0xFFFFFFFF:   # 接受包括 0 在内的任何值（M 系 DEV_ID 缺席=0）
                    pid = v
                    used_addr = addr
                    break
            except Exception:
                continue

        dev_id = pid & 0xFFF
        rev_id = (pid >> 16) & 0xFFFF
        log('[INFO] DEV_ID=0x%03X REV_ID=0x%04X (via %s)' % (dev_id, rev_id, used_addr or 'n/a'))

        # ---- UID 64bit @0x1FFFF818（图 3-2 实锤；不是 ST 的 0x1FFFF7AC！）----
        # 诊断模式：首读数据 02FD00005CC33000 过半是 0、且与 F7AC 的 CC330000CC330000
        # 循环模式共享 CC3300 特征，疑似该区域非真 UID 或读通路异常——dump 信息块窗口 +
        # 双读验证稳定性，待结构确认后移除本段（只走 stderr，不影响 JSON）
        try:
            win = bytes(target.read_memory_block8(0x1FFFF780, 0x100))  # 0x1FFFF780~F87F
            for off in range(0, len(win), 16):
                log('[DUMP] 0x%08X: %s' % (0x1FFFF780 + off,
                    ' '.join('%02X' % b for b in win[off:off + 16])))
        except Exception as e:
            log('[WARN] 信息块窗口 dump 失败: %s' % e)

        uid_bytes = bytes(target.read_memory_block8(UID_ADDR, UID_LEN))
        uid2 = bytes(target.read_memory_block8(UID_ADDR, UID_LEN))
        uid = uid_bytes.hex().upper()
        log('[INFO] UID 双读稳定性: %s' % ('一致 ✓' if uid == uid2.hex().upper() else
            '不一致 ✗ %s / %s' % (uid, uid2.hex().upper())))

        # 交叉验证：字读 vs 字节读（F818 区域读数怀疑与访问方式/状态相关）
        try:
            w0 = target.read32(UID_ADDR)
            w1 = target.read32(UID_ADDR + 4)
            log('[INFO] UID 字读: %08X %08X' % (w0, w1))
        except Exception as e:
            log('[WARN] UID 字读失败: %s' % e)
        try:
            ref_w = target.read32(0x1FFFF7AC)
            log('[INFO] F7AC 字读: %08X' % ref_w)
        except Exception as e:
            log('[WARN] F7AC 字读失败: %s' % e)

        # 决定性诊断①：直接读 EEPROM 总线 0x0C000000（448B）——datasheet 称选项字/出厂设置
        # "in EEPROM"，F8xx 疑似只是其别名视图；真 UID 可能在这
        try:
            ee = bytes(target.read_memory_block8(0x0C000000, 0x1C0))
            log('[INFO] EEPROM @0x0C000000 (%d B):' % len(ee))
            for off in range(0, len(ee), 16):
                log('[EEDUMP] 0x%08X: %s' % (0x0C000000 + off,
                    ' '.join('%02X' % b for b in ee[off:off + 16])))
        except Exception as e:
            log('[WARN] EEPROM 读取失败: %s' % e)

        # 决定性诊断②：SRAM 头 64B——若与 F7xx 内容吻合，则 F7xx 是 SRM 别名（易失实锤）
        try:
            sram = bytes(target.read_memory_block8(0x20000000, 0x40))
            log('[INFO] SRAM @0x20000000: %s' % ' '.join('%02X' % b for b in sram))
        except Exception as e:
            log('[WARN] SRAM 读取失败: %s' % e)
        # 对照诊断：ST 风格地址 0x1FFFF7AC 上 M 系是什么（仅记日志）
        try:
            ref = bytes(target.read_memory_block8(0x1FFFF7AC, 8))
            log('[INFO] ref @0x1FFFF7AC = %s' % ref.hex().upper())
        except Exception:
            pass

        if uid == '00' * UID_LEN or uid == 'FF' * UID_LEN:
            out_json({'ok': False, 'error': 'no_device',
                      'hint': 'UID @0x1FFFF818 读出全 %s（确认 SWD 四线、芯片上电、SWDIO/SWCLK 引脚按 datasheet 第 6 章 TSSOP20 核对）'
                              % ('0' if uid[0:2] == '00' else 'F')})
            sys.exit(0)

        log('[INFO] UID(64bit): %s' % uid)

        out_json({
            'ok': True,
            'model': 'HK32F030M',
            'vendor': 'Hangshun',
            'uid': uid,
            'uid_length': UID_LEN,
            'dev_id': '0x%03X' % dev_id,
            'rev_id': '0x%04X' % rev_id,
            'flash_kb': FLASH_KB,
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

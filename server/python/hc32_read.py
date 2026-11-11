#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
hc32_read.py — XHSC 小华（原华大 HDSC）HC32 系列 SWD 信息读取（只读 identify）【HC32 专属通道】

架构：
  传输层：pyOCD（CMSIS-DAP = WCH-LinkE DAP 模式，免驱）
  目标：generic cortex_m（attach 模式，不打扰运行中的芯片）
  识别：CPUID 诊断 + 电子签名区直读（HDSC 官方无 DBG_IDCODE/DEV_ID 实锤，仅记录候选）

签名区实锤（HC32L110 数据手册 Rev2.72 §器件电子签名）：
  - 唯一 ID 10 字节 @ 0x0010 0E74 - 0x0010 0E7F（wafer lot 信息 + 芯片坐标）
  - 版本演化注意：老版 DS 曾写「16Byte @0x0010_0E70-0x0010_0E7F」（2020 早期印次）、
    部分代理商 PDF 写 0x0010_0E76 起——以 Rev2.72 的 0x0010 0E74 起为准；
    脚本会 dump 0x0010 0E70 起整个 16 字节窗口供人工核对，UID 取 0xE74 起 10B
  - 华大 UID 规则（社区实锤，HC32F030 例）：Lot 6B + X 坐标 1B + Y 坐标 1B + Wafer 1B + 版本 1B；
    Lot 六字节转十进制 = 芯片丝印上的 Lot Number

⚠️ 硬件坑（血泪实锤，2026-11-06）：HC32L110 的 VCAP 引脚 = 内部 LDO 内核供电输出
  （官方 DS：仅限内部电路使用，连接 4.7uF 电容到 GND；TSSOP20 pin8，典型电压 1.55V）。
  VCAP 悬空 → LDO 振荡 → flash 总线读数"位拉 1"污染（FF/7F 假数据，读数与长度/宽度相关）。
  本系列首测（档案 #59，UID 370DFFFF0000110E78E1 中间含 FFFF）即为 VCAP 悬空污染；
  接 4.7uF（实测 0.1uF 亦可稳定）后重读为准。

前置：WCH-LinkE 处于 DAP 模式（API 层已做模式保险）。
接线：SWD 四线（SWDIO/SWCLK/GND/3V3）+ VCAP 对 GND 电容。

stdout 只输出最终 JSON；过程日志全走 stderr（ASCII）。
"""

import sys
import json
import logging

logging.getLogger('pyocd').setLevel(logging.WARNING)
logging.basicConfig(level=logging.WARNING)

CPUID_ADDR = 0xE000ED00

# 电子签名区（HC32L110 DS Rev2.72 实锤）
UID_WINDOW_ADDR = 0x00100E70   # 老版 16B 口径起点，dump 供核对
UID_ADDR = 0x00100E74          # Rev2.72 官方：10 字节 UID 起点
UID_LEN = 10
WINDOW_LEN = 16

# DBG_IDCODE 候选（仅记录诊断用，不做家族门槛；HDSC 官方无 DEV_ID 实锤）
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
    log('[INFO] HC32 SWD reader start (pyocd CMSIS-DAP)')

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

        # ---- DBG_IDCODE 候选（仅记录；HDSC 官方无 DEV_ID 实锤）----
        dev_id = ''
        try:
            pid = target.read32(DBG_ID_ADDR)
            if pid and pid != 0xFFFFFFFF:
                dev_id = '0x%03X' % (pid & 0xFFF)
                log('[INFO] DBG_IDCODE @0x%08X = 0x%08X (DEV_ID=%s)'
                    % (DBG_ID_ADDR, pid, dev_id))
        except Exception as e:
            log('[INFO] DBG_IDCODE read skipped: %s' % e)

        # ---- 电子签名区：16B 全窗口 dump（双读校验，兼容老版口径核对）+ 官方 10B UID ----
        window = read_uid_verified(target, UID_WINDOW_ADDR, WINDOW_LEN, 'HC32 UID window')
        log('[INFO] UID window 16B @0x%08X: %s' % (UID_WINDOW_ADDR, window.hex().upper()))
        uid_bytes = window[UID_ADDR - UID_WINDOW_ADDR: UID_ADDR - UID_WINDOW_ADDR + UID_LEN]
        uid = uid_bytes.hex().upper()
        log('[INFO] UID(%dB) @0x%08X: %s' % (UID_LEN, UID_ADDR, uid))

        if uid in ('', 'FF' * UID_LEN, '00' * UID_LEN):
            out_json({'ok': False, 'error': 'bad_signature',
                      'hint': '签名区 UID 读出全空（%s）——核对地址映射或接线；'
                              '若持续出现请反馈日志' % uid})
            sys.exit(0)

        # 注：HC32L110 真 UID 可合法含 FF（#59 档案实锤 370DFFFF0000110E78E1 稳定复现），
        # 故不对 FF 内容报警；仅当读数本身不稳定时才怀疑 VCAP（悬空血泪教训）
        if b'\xFF\xFF' in uid_bytes:
            log('[INFO] UID 含连续 FF 字节——本系列真 UID 可合法含 FF（跨会话稳定即有效）；'
                '仅当多次读取结果不一致时才怀疑 VCAP 未接电容')

        out_json({
            'ok': True,
            'model': 'HC32L110',
            'vendor': 'XHSC',
            'uid': uid,
            'uid_length': UID_LEN,
            'cpuid': '0x%08X' % cpuid,
            'dev_id': dev_id,
            'uid_window': window.hex().upper(),
            'flash_kb': None,
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

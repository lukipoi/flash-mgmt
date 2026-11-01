#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
stc_serial_newgen_probe.py — 实验脚本：新代 STC BSL（AI8H2K12U）串口协议探测

背景（全部实测）：
  - 串口 0x7f 握手成功（2400，状态包 46B9 帧收到，magic=0x7896）
  - stcgal 的老命令集（0x65 校准/切波特率）新 BSL 不认 → 深检测失败
  - USB 抓包逆出的新命令帧（46B9+6a+len+载荷+csum u16BE+16）已实测可用：
    05+5aa5=解锁、03+5aa5=读 UID(7B，前 2B=型号魔数)
本脚本验证：新命令帧直接走串口（2400 起步，115200 兜底）是否被 BSL 接受。
"""
import serial
import sys
import time

PORT = sys.argv[1] if len(sys.argv) > 1 else 'COM5'

F_SYNC  = bytes.fromhex('46b96a000700007116')                 # 07 同步（载荷 00）
F_UNLOCK= bytes.fromhex('46b96a000b0500005aa5017916')         # 05 解锁
F_UID   = bytes.fromhex('46b96a000b0300005aa5017716')         # 03 读 UID


def log(msg):
    print(msg, file=sys.stderr)
    sys.stderr.flush()


def extract_frames(buf):
    """46B9 [marker] [len u16BE] [payload] [csum u16BE] 16 —— len=载荷+6"""
    frames = []
    i = 0
    while i < len(buf) - 6:
        if buf[i] == 0x46 and buf[i + 1] == 0xB9:
            ln = (buf[i + 3] << 8) | buf[i + 4]
            total = 2 + ln
            if ln >= 5 and i + total <= len(buf) and buf[i + 2 + ln - 1] == 0x16:
                frames.append(bytes(buf[i:i + total]))
                i += total
                continue
        i += 1
    return frames


def wait_status(ser, timeout_s=4):
    """等状态包（46B9 帧 ≥ 40B）——上电后 BSL 对 0x7f 的应答"""
    buf = bytearray()
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        ser.write(b'\x7f')
        time.sleep(0.05)
        n = ser.in_waiting
        if n:
            buf.extend(ser.read(n))
        fs = [f for f in extract_frames(buf) if len(f) >= 40]
        if fs:
            return fs[-1], bytes(buf)
    return None, bytes(buf)


def try_baud(baud, do_power_cycle):
    import subprocess
    import threading
    log('=== 尝试 %d baud ===' % baud)
    WL = 'D:/CH341-SPI/flash-mgmt/server/python/bin/wlink-win-x86/wlink.exe'
    if do_power_cycle:
        subprocess.run([WL, 'set-power', 'disable3v3'], capture_output=True)
        time.sleep(0.8)
    ser = serial.Serial(PORT, baud, timeout=0.2)

    # 连续 0x7f 脉冲线程：上电前就开始（stcgal 成功时序的精髓）
    stop = threading.Event()
    def pulse():
        while not stop.is_set():
            try:
                ser.write(b'\x7f'); ser.flush()
            except Exception:
                return
            time.sleep(0.05)
    pt = threading.Thread(target=pulse, daemon=True)
    pt.start()

    try:
        if do_power_cycle:
            time.sleep(0.4)
            subprocess.run([WL, 'set-power', 'enable3v3'], capture_output=True)
        status, raw = wait_status(ser, timeout_s=5)
        stop.set(); pt.join(timeout=1)
        if status is None:
            log('[FAIL] 无状态包（0x7f 握手失败）')
            return None
        log('[OK] 状态包 %dB: %s' % (len(status), status.hex().upper()))
        if len(status) > 21:
            log('[INFO] magic(20:22) = 0x%04X' % ((status[20] << 8) | status[21]))

        # 照 USB 会话的完整命令顺序重放：07 → 01 → 05 → 03
        F_CMD01 = bytes.fromhex('46b96a000e010000000000008000f916')
        seq = (('07 同步', F_SYNC), ('01 握手', F_CMD01), ('05 解锁', F_UNLOCK), ('03 读UID', F_UID))
        for name, f in seq:
            ser.reset_input_buffer()
            ser.write(f)
            time.sleep(0.5)
            n = ser.in_waiting
            resp = ser.read(n) if n else b''
            frames = extract_frames(resp)
            log('[%s] 应答 %d 帧 %s' % (name, len(frames),
                ' | '.join(f.hex().upper() for f in frames) if frames else
                ('raw: ' + resp.hex().upper() if resp else '(无)')))
        return status
    finally:
        stop.set()
        ser.close()


# 主流程：先不切电试一次（芯片可能已在 BOOT），失败再带断电重启
log('port=%s' % PORT)
st = try_baud(2400, do_power_cycle=False)
if st is None:
    st = try_baud(2400, do_power_cycle=True)
if st is None:
    st = try_baud(115200, do_power_cycle=True)

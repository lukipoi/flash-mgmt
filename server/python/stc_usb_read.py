#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
stc_usb_read.py — STC AI8H2K12U USB ISP 芯片信息读取（只读 identify）

协议来源：Wireshark + USBPcap 抓取官方 STC-ISP V6.97 成功会话（11 帧），
逐字节复刻，未做任何猜测。帧格式经 4 帧交叉验证 + 真机全流程验证。

硬件：AI8H2K12U（VID 0x34BF / PID 0x1001，HID product "USB-ISP"）
进 BOOT：P3.2 短接 GND + 重新上电（识别后 P3.2 无关）
传输：hidapi 免驱

帧格式（抓包 + 真机双验证）：
  46 B9 | 6A/68 (HOST/MCU 标记) | len u16 BE (从标记字节到 END 的字节数) | 数据 | 校验 | 16
  校验规则（经验证）：MCU 帧 sum(标记..数据尾)&0xFF == 校验字节（HOST 帧同）
  AI8H2K12U 命令集：07=同步查询(应答状态包) 01=握手 05+5aa5=解锁
                    03+5aa5=读 UID(应答含 8 字节 UID) ff=结束跳 FLASH

stdout 只输出最终 JSON；过程日志全走 stderr（ASCII）。
"""

import hid
import sys
import json
import time

VID, PID = 0x34BF, 0x1001

# 官方成功会话命令帧（verbatim 抓包）
FRAME_SYNC    = bytes.fromhex('46b96a000700007116')                 # 07 同步查询
FRAME_CMD01   = bytes.fromhex('46b96a000e010000000000008000f916')   # 01 握手
FRAME_UNLOCK  = bytes.fromhex('46b96a000b0500005aa5017916')         # 05 解锁
FRAME_READUID = bytes.fromhex('46b96a000b0300005aa5017716')         # 03 读 UID
FRAME_END     = bytes.fromhex('46b96a0007ff017016')                 # ff 结束

# 型号魔数映射（0x7896 = AI8H2K12U，来源：串口状态包 stcgal "Unknown model 7896"
# 与 USB 03 应答开头两字节互证；遇到新 STC USB 芯片在此补行）
MODEL_MAP = {0x7896: 'AI8H2K12U'}

READ_WAIT_MS = 300


def log(msg):
    print(msg, file=sys.stderr)
    sys.stderr.flush()


def out_json(obj):
    print(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()


def open_device(timeout_s=20):
    """轮询等待 STC USB-ISP 设备（等待用户 P3.2 短接 + 重新上电）"""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        infos = [d for d in hid.enumerate() if d['vendor_id'] == VID and d['product_id'] == PID]
        if infos:
            h = hid.device()
            h.open_path(infos[0]['path'])
            return h
        time.sleep(0.4)
    return None


def extract_frames(stream):
    """按 len 字段(u16 BE)切帧：46B9 [marker] [len u16 BE] [data] [csum] 16"""
    frames = []
    i = 0
    while i < len(stream) - 6:
        if stream[i] == 0x46 and stream[i + 1] == 0xB9:
            ln = (stream[i + 3] << 8) | stream[i + 4]
            total = 2 + ln
            if ln >= 5 and i + total <= len(stream) and stream[i + 2 + ln - 1] == 0x16:
                frames.append(bytes(stream[i:i + total]))
                i += total
                continue
        i += 1
    return frames


def read_frames(h, timeout_s=2.5, expect=1):
    """累积输入报告流并重组帧；拿到 expect 帧即提前返回"""
    stream = bytearray()
    frames = []
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        r = h.read(65, timeout_ms=250)
        if not r:
            continue
        stream.extend(r)
        frames = extract_frames(stream)
        if len(frames) >= expect:
            break
    return frames


def send(h, frame):
    h.write(b'\x00' + frame + bytes(64 - 1 - len(frame)))


def main():
    log('[INFO] STC USB-ISP reader start (VID 0x34BF PID 0x1001)')
    h = open_device(timeout_s=20)
    if h is None:
        out_json({'ok': False, 'error': 'no_device',
                  'hint': '未检测到 STC USB-ISP 设备：P3.2 短接 GND + 重新上电后再试'})
        sys.exit(0)
    log('[INFO] device opened (USB-ISP)')

    # ---- 07 同步查询 → 状态包 ----
    send(h, FRAME_SYNC)
    fs = read_frames(h, 3)
    if not fs:
        out_json({'ok': False, 'error': 'sync_timeout',
                  'hint': '同步命令无应答（确认 P3.2 短接后重新上电、STC-ISP 已关闭）'})
        h.close()
        sys.exit(0)
    status = fs[0]
    status_hex = status.hex().upper()
    log('[INFO] status: ' + status_hex)

    # 状态帧里找型号魔数（29 20 → AI8H2K12U）
    model = None
    for i in range(len(status) - 1):
        magic = (status[i] << 8) | status[i + 1]
        if magic in MODEL_MAP:
            model = MODEL_MAP[magic]
            model_magic = '0x%04X' % magic
            break
    if model is None:
        model = 'STC(未知型号)'
        model_magic = '0x2920?'
    log('[INFO] model: %s (magic %s)' % (model, model_magic))

    # ---- 01 握手 ----
    send(h, FRAME_CMD01)
    f01 = read_frames(h, 2)
    log('[INFO] cmd01: ' + (f01[-1].hex().upper() if f01 else 'no-reply'))

    # ---- 05 解锁 ----
    send(h, FRAME_UNLOCK)
    f05 = read_frames(h, 2)
    log('[INFO] unlock: ' + (f05[-1].hex().upper() if f05 else 'no-reply'))

    # ---- 03 读 UID ----
    uid = ''
    send(h, FRAME_READUID)
    f03 = read_frames(h, 2)
    for f in f03:
        log('[INFO] uid reply: ' + f.hex().upper())
        # 帧: 46b9 68 [len u16BE] 03 [UID 7B] [csum u16BE] 16
        # 抓包样本: 46b968000e037896cbd3034f13038a16 → UID=7896CBD3034F13（7 字节，前 2B=型号魔数）
        body = f[5:-3]   # 去 46b9、marker+len(3B: 68 00 0e)、尾部 csum u16+16
        if len(body) >= 8 and body[0] == 0x03:
            uid = body[1:8].hex().upper()
    if not uid:
        log('[WARN] UID 未取得（03 应答缺失或格式变化）')

    # ---- 不发 ff 结束命令：留在 BOOT，连续读取免反复进 BOOT；用户重新上电即回用户程序 ----
    try:
        h.close()
    except Exception:
        pass

    log('[INFO] done, uid=' + (uid or 'none'))
    out_json({
        'ok': True,
        'model': model,
        'uid': uid,
        'uid_length': len(uid) // 2 if uid else 0,
        'status_hex': status_hex,
    })


if __name__ == '__main__':
    main()

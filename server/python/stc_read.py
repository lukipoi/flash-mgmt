"""STC 单片机 UID/校准数据读取（flash-mgmt 后端辅助脚本）。

库方式复用 stcgal 1.10（MIT）协议实现，只执行到握手+初始化阶段：
  connect() → 自动检测协议 → initialize(base) → **立即停**（不发 erase/program）
  → disconnect()，芯片程序原样保留，全程无擦除无写入。

拿到的数据：
  - uid:       7 字节唯一 ID（各系列在握手/识别 packet 中）
  - model:     具体型号（如 STC8H1K08）与协议名
  - trim_data: 出厂 IRC 校准挑战表（7 字节，status packet[51:58]）
  - clock_hz:  BSL 实测时钟

stdout 是唯一输出通道：stcgal 内部 print 全部重定向捕获，避免污染 JSON。
依赖：stcgal（pip install stcgal，自带 pyserial）。
"""
import io
import json
import os
import struct
import subprocess
import sys
import threading
import time

# WCH-LinkE 电源输出控制（实测 v3.6 固件可用；仅 LinkE/DAPLink/LinkW 支持）
WLINK_EXE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         "bin", "wlink-win-x86", "wlink.exe")


def _wlink_power(state: str):
    if os.path.isfile(WLINK_EXE):
        # 输出强制走 stderr：wlink 的 INFO 日志绝不能进 stdout（那里只许最终 JSON）
        subprocess.run([WLINK_EXE, "set-power", state], timeout=15,
                       stdout=sys.stderr, stderr=sys.stderr)
        print(f"--- wlink set-power {state} done ---")


def out(obj, code=0):
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(code)


def to_hex(b):
    return b.hex().upper() if isinstance(b, (bytes, bytearray)) else None


def read_chip(port: str, trim_mhz: float, erase: bool = False, auto_cycle: bool = False):
    from stcgal.frontend import StcGal
    from stcgal.protocols import StcAutoProtocol, StcProtocolException
    from stcgal import models as stc_models

    from types import SimpleNamespace

    # stcgal 老 bug 补丁：未知型号兜底（protocols.py:218）构造 MCUModel 时漏了
    # 新增的 iap/calibrate/mcs251 三个字段 → TypeError（AI8H2K12U 实测踩中——
    # 其串口握手本身成功，magic 只是型号库查无此条）。给缺省字段自动补齐：
    # mcs251=True（AI8H/STC32 系为 251 内核），iap=True，calibrate=True。
    _OrigMCUModel = stc_models.MCUModelDatabase.MCUModel
    if not issubclass(getattr(stc_models.MCUModelDatabase, '_MCUModelPatchedMarker', type(None)), _OrigMCUModel):
        class _MCUModelPatched(_OrigMCUModel):
            pass
        _orig_new = _OrigMCUModel.__new__
        _defaults = {5: True, 6: True, 7: True}   # iap, calibrate, mcs251
        def _patched_new(cls, *args, **kwargs):
            if cls is _MCUModelPatched:
                # 兜底路径（protocols.py:218）走关键字：name/magic/total/code/eeprom，缺 3 个新字段
                for k, v in (('iap', True), ('calibrate', True), ('mcs251', True)):
                    kwargs.setdefault(k, v)
                # 位置参数路径同样补齐
                while len(args) < 8 and len(args) in _defaults:
                    args.append(_defaults[len(args)])
            return _orig_new(cls, *args, **kwargs)
        _MCUModelPatched.__new__ = _patched_new
        stc_models.MCUModelDatabase.MCUModel = _MCUModelPatched
        stc_models.MCUModelDatabase._MCUModelPatchedMarker = _MCUModelPatched

    # stcgal 的日志实时透传到 stderr（前端日志框展示原文），stdout 只留给最终 JSON
    real_stdout = sys.stdout
    sys.stdout = sys.stderr
    # stcgal 源码（protocols.py read_packet/handshake/erase_flash）：connect() 的
    # 检测循环会吞掉脏帧重试，但 handshake()/erase_flash() 是单发读包、零容忍——
    # 上电瞬间串口垃圾字节混入即抛 "incorrect frame start"。自动断电重启模式下
    # 整段「断电→上电→握手→擦除」重试（重新上电让 BSL 回到 2400 初始态）；
    # 手动模式无权重来（用户在场，失败自己看着办）
    max_attempts = 3 if auto_cycle else 1
    info = None
    last_err = None
    try:
        for attempt in range(1, max_attempts + 1):
            power_timer = None
            gal = None
            try:
                if auto_cycle and os.path.isfile(WLINK_EXE):
                    # 自动断电重启：先断 3V3，connect() 打开串口开始 2400 下 pulse 0x7f，
                    # 0.4s 后重新上电——STC 仅在上电瞬间检测下载口令，时序正好命中
                    print(f"--- wlink set-power disable3v3（第 {attempt}/{max_attempts} 次）---")
                    _wlink_power("disable3v3")
                    time.sleep(0.6)
                    power_timer = threading.Timer(0.4, _wlink_power, args=("enable3v3",))
                    power_timer.start()
                opts = SimpleNamespace(port=port, handshake=2400, baud=115200, protocol=None,
                                       trim=trim_mhz, debug=False)
                gal = StcGal(opts)
                base = gal.protocol
                base.connect(autoreset=False, resetcmd=None, resetpin=None)

                basep = None
                if isinstance(base, StcAutoProtocol):
                    if not base.protocol_name:
                        raise RuntimeError("无法自动检测协议（芯片未进 BSL？请断电后重新上电）")
                    opts.protocol = base.protocol_name
                    gal.initialize_protocol(opts)
                    basep = base

                p = gal.protocol
                p.initialize(basep)  # initialize_status：trim_data / 时钟解析完毕
                if erase:
                    # stc15/12/8 系列 BSL 仅在擦除应答(response[1:8])中附带 UID，
                    # 握手包里没有。擦除前必须走官方 erase_mcu() 同款前置
                    # handshake()：TRIM 校准 + 切到 115200 传输波特率 + 0x05 准备命令；
                    # 否则 0x03 在 2400 握手波特率下被 BSL 当无效命令，应答为脏字节
                    #（实测报 "incorrect frame start"）。
                    #
                    # 实测 STC15W408AS：calibrate 的 target_prog_count = 22118400/1200
                    # = 18432，卡在 BSL 挑战上限 18424 边缘（差 0.04%），choose_range
                    # 夹不住返回 None → "frequency trimming unsuccessful"，成败随 IRC
                    # 上电漂移抖动。补丁：夹不住时取最接近的挑战端点线性外推 trim，
                    # 0.04% 的频率误差对 115200 波特率（容差 2%）无影响。
                    # （类级补丁只打一次，重试轮不会二次包裹）
                    cls = type(p)
                    if not hasattr(cls, "_orig_choose_range"):
                        cls._orig_choose_range = cls.choose_range

                        def _choose_range_relaxed(self, packet, response, target_count,
                                                  _orig=cls._orig_choose_range):
                            # stcgal 的 Stc8d/Stc8g.choose_range 在 trim 落到边缘（<6 或 >250）
                            # 时会直接抛 "frequency trimming failed"——因为它第 2 轮校准要
                            # 无防护地探测 trim±6（Stc8g.calibrate: bytes([user_trim[0]+i,...])）。
                            # 这里接住改走外推，且外推值 clamp 到 [6,249] 给 ±6 留余量，
                            # 否则第 2 轮直接 ValueError "bytes must be in range(0, 256)"
                            # （STC8H1K08T 实测踩中）。代价：边缘 trim 最多偏 6 档，
                            # 对只读模式无影响（BSL 切波特率用固定 24M 重装值，不依赖 user trim）。
                            try:
                                result = _orig(self, packet, response, target_count)
                            except StcProtocolException:
                                result = None
                            if result is not None:
                                return result
                            calib_data = response[2:]
                            challenge_data = packet[2:]
                            calib_len = response[1]
                            best = None
                            best_dist = None
                            for i in range(calib_len - 1):
                                count_a, count_b = struct.unpack(">HH", calib_data[2 * i:2 * i + 4])
                                trim_a, trim_b, trim_range = struct.unpack(">BxBB", challenge_data[2 * i:2 * i + 4])
                                dist = min(abs(count_a - target_count), abs(count_b - target_count))
                                if best_dist is None or dist < best_dist:
                                    best_dist = dist
                                    m = (trim_b - trim_a) / (count_b - count_a) if count_b != count_a else 0
                                    t = round(m * target_count + (trim_a - m * count_a))
                                    best = (max(6, min(249, t)), trim_range)
                            if best is None:
                                raise RuntimeError("校准挑战数据为空")
                            return best

                        cls.choose_range = _choose_range_relaxed
                    p.handshake()
                    p.erase_flash(p.model.code, p.model.code)  # 只擦用户区，不动 EEPROM
                info = {
                    "protocol": base.protocol_name or opts.protocol,
                    "uid": to_hex(getattr(p, "uid", None)),
                    "model": getattr(getattr(p, "model", None), "name", None),
                    "magic": ("0x%04X" % getattr(p, "mcu_magic", 0)) if getattr(p, "mcu_magic", None) else "",
                    "bsl_version": getattr(p, "version", None),
                    "clock_hz": getattr(p, "mcu_clock_hz", None),
                    "trim_data": to_hex(getattr(p, "trim_data", None)),
                }
                try:
                    p.disconnect()
                except Exception:
                    pass  # disconnect 失败不影响已到手的 UID，别为它触发重试
                break
            except Exception as e:
                last_err = e
                # 释放串口（protocols.py: initialize 复用 base_protocol.ser），
                # 否则下一轮 connect 打不开端口
                try:
                    ser = getattr(getattr(gal, "protocol", None), "ser", None)
                    if ser is not None and getattr(ser, "is_open", False):
                        ser.close()
                except Exception:
                    pass
                if attempt < max_attempts:
                    print(f"[重试 {attempt}/{max_attempts}] {e}，重新断电上电再试…")
                    time.sleep(0.8)
            finally:
                if power_timer:
                    power_timer.cancel()
        if info is None:
            raise last_err if last_err else RuntimeError("读取失败")
        return info
    finally:
        sys.stdout = real_stdout


def list_ports():
    from serial.tools import list_ports

    ports = [{"device": p.device, "description": p.description} for p in list_ports.comports()]
    out({"ok": True, "ports": ports})


def main():
    argv = sys.argv[1:]

    if "--ports" in argv:
        try:
            list_ports()
        except SystemExit:
            raise
        except Exception as e:
            out({"ok": False, "error": f"枚举串口失败: {e}"}, 1)
        return

    if "--port" not in argv:
        out({"ok": False, "error": "用法: stc_read.py --ports | --port COMx [--trim MHz] [--erase-uid]"}, 1)
        return

    port = argv[argv.index("--port") + 1]
    trim_mhz = 22.1184
    if "--trim" in argv:
        try:
            trim_mhz = float(argv[argv.index("--trim") + 1])
        except (ValueError, IndexError):
            pass
    erase = "--erase-uid" in argv
    auto_cycle = "--auto-cycle" in argv
    if erase and "--trim" not in argv:
        # 校准目标 22.1184MHz 的计数(18432)卡在 BSL 挑战覆盖(≤18424)边缘，
        # 成败随 IRC 上电漂移抖动。erase-only 模式校准值不写入芯片，
        # 目标频率只要让 calibrate 通过即可 → 降到 20MHz（计数居中，必定夹住）
        trim_mhz = 20.0

    try:
        info = read_chip(port, trim_mhz, erase, auto_cycle)
        if erase and not info.get("uid"):
            out({"ok": False, "error": "擦除应答未取得 UID"}, 1)
        # 只读模式 uid 允许为空（stc15/12/8 系列握手包不带 UID，属正常）
        out({"ok": True, **info})
    except SystemExit:
        raise
    except Exception as e:
        msg = str(e) or e.__class__.__name__
        # stcgal 原始异常翻译成人话（UI 不裸吐工具报错）：
        # - "bytes must be in range(0, 256)"：handshake() 构造波特率切换包时越界
        #   （protocols.py L542 bytes([0xff-(brt>>8), ...])）——COM 口上有设备对 0x7f
        #   脉冲回了"疑似 STC"的应答（如 WCH-LinkE / CH55x），stcgal 误判协议后
        #   用垃圾时钟数据算出非法 brt。本质 = 串口上有东西，但不是 STC 芯片。
        # - "frequency trimming unsuccessful"：IRC 校准夹不住（上电漂移），自动重试
        #   仍失败时提示重试即可。
        if "bytes must be in range" in msg:
            msg = "串口有设备应答但不是 STC 芯片（确认选对串口、选对读取器系列）"
        elif "frequency trimming unsuccessful" in msg:
            msg = "IRC 频率校准未成功（上电漂移），请重新断电上电后再试"
        elif "无法自动检测协议" in msg or "protocal" in msg or "protocol" in msg:
            msg = "未检测到 STC 芯片（确认已断电重新上电、串口未被占用）"
        out({"ok": False, "error": f"读取失败: {msg}"}, 1)


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()

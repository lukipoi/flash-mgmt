"""扫描仪单次扫描 + 条码/二维码解码（flash-mgmt 后端辅助脚本）。

由 Nitro 通过 `python -X utf8 scan_once.py --list | --scan` 调用（server/utils/scannerRuntime.ts），
结果以 UTF-8 JSON 输出到 stdout，不落盘、不常驻（避免独立服务进程）。

扫描桥接与解码逻辑精简自 EXP-SCAN 项目的 wia_bridge.py / barcode_engine.py：
  - WIA(Windows Image Acquisition) 2.0 自动化 COM，64 位 Python 直接用，无需 DSM
  - 转 BMP（几乎所有 WIA 设备支持）后内存解码，临时文件即用即删
  - zxing-cpp 离线解码 QR / Code128 / Code39 等，无需网络

依赖：pywin32、Pillow、numpy、zxing-cpp（本机全局 Python 已装齐）。
"""
import json
import sys
import tempfile
import time
from pathlib import Path


def out(obj, code=0):
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(code)


# WIA 图像格式 GUID（BMP 兼容性最好）
WIA_FORMAT_BMP = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}"
# WIA_INTENT 色彩意图：1=彩色 2=灰度 4=黑白(文本)
_INTENT = {"color": 1, "gray": 2, "bw": 4}
# WIA_IPA_DATATYPE：1=彩色 2=灰度 3=黑白（部分 HP 驱动更认 Datatype，两处都设）
_DATATYPE = {"color": 1, "gray": 2, "bw": 3}


def list_scanners():
    import win32com.client

    dm = win32com.client.Dispatch("WIA.DeviceManager")
    scanners = []
    for info in dm.DeviceInfos:
        if info.Type == 1:  # ScannerDeviceType
            scanners.append({"id": info.DeviceID, "name": info.Properties["Name"].Value})
    out({"ok": True, "scanners": scanners})


def scan_once(dpi: int, pixel: str, name: str | None):
    t0 = time.time()
    import win32com.client
    import zxingcpp
    import numpy as np
    from PIL import Image

    dm = win32com.client.Dispatch("WIA.DeviceManager")
    infos = [i for i in dm.DeviceInfos if i.Type == 1]
    if not infos:
        out({"ok": False, "error": "未找到 WIA 扫描仪（确认驱动已装、USB 已连、设备已开机）"}, 1)

    dev_info = infos[0]
    if name:
        for i in infos:
            dev_name = i.Properties["Name"].Value
            if name == i.DeviceID or name.lower() in dev_name.lower():
                dev_info = i
                break

    device = dev_info.Connect()
    item = device.Items[1]  # 1-based：平板扫描面

    def setp(prop_name, value):
        try:
            item.Properties[prop_name].Value = value
        except Exception:
            pass  # 驱动不暴露该属性时静默忽略

    setp("Horizontal Resolution", int(dpi))
    setp("Vertical Resolution", int(dpi))
    setp("Current Intent", _INTENT.get(pixel, 2))
    setp("Datatype", _DATATYPE.get(pixel, 2))

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td) / "scan.bmp"
        image_file = item.Transfer(WIA_FORMAT_BMP)
        image_file.SaveFile(str(tmp))
        img = Image.open(tmp)
        img.load()  # 强制读入内存，临时目录随即销毁

    arr = np.asarray(img.convert("L"))  # 灰度，zxing 最稳
    texts, seen = [], set()
    try:
        for r in zxingcpp.read_barcodes(arr):
            t = str(r.text)
            if t and t not in seen:
                seen.add(t)
                texts.append({"text": t, "format": str(r.format).split(".")[-1]})
    except Exception:
        pass

    out({"ok": True, "texts": texts, "elapsed_ms": int((time.time() - t0) * 1000)})


def main():
    argv = sys.argv[1:]

    if "--list" in argv:
        try:
            list_scanners()
        except SystemExit:
            raise
        except Exception as e:
            out({"ok": False, "error": f"枚举扫描仪失败: {e}"}, 1)
        return

    if "--scan" not in argv:
        out({"ok": False, "error": "用法: scan_once.py --list | --scan [--dpi N] [--pixel gray|color|bw] [--name 关键词]"}, 1)
        return

    def argval(flag, default):
        i = argv.index(flag)
        return argv[i + 1] if i + 1 < len(argv) else default

    dpi = int(argval("--dpi", "300"))
    pixel = argval("--pixel", "gray")
    name = argval("--name", None) if "--name" in argv else None

    try:
        scan_once(dpi, pixel, name)
    except SystemExit:
        raise
    except Exception as e:
        out({"ok": False, "error": f"扫描失败: {e}"}, 1)


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()

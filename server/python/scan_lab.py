"""扫描提速实验脚本（scan_lab.py）—— 实验性功能，验证通过才进正式 UI。

复用 scan_once.py 的实现，逐项真机验证：

  python scan_lab.py escl-cap      # 1. eSCL 能力探测：192.168.1.208 可达？平板尺寸/分辨率/色彩
  python scan_lab.py escl-full     # 2. eSCL 整面一发：ScanJob→轮询→NextDocument→解码 全链路
  python scan_lab.py escl-tiles    # 3. eSCL 分块 2x2：逐块计时，扫到即停
  python scan_lab.py wia-tiles     # 4. WIA 分块 2x2：USB 路径对照
  python scan_lab.py wia-full      # 5. WIA 整面：旧基线（对照计时用）

通用参数：--base http://192.168.1.208/eSCL  --dpi 300  --pixel gray  --tiles 2x2
日志走 stderr（[INFO]/[WARN]），stdout 只出最终 JSON 摘要。
"""
import json
import sys
import time

import scan_once


def info(msg):
    print(f"[INFO] {msg}", file=sys.stderr)


def warn(msg):
    print(f"[WARN] {msg}", file=sys.stderr)


def finish(obj):
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(0)


def cmd_escl_cap(base):
    import xml.etree.ElementTree as ET
    import urllib.request

    t0 = time.time()
    url = f"{base.rstrip('/')}/ScannerCapabilities"
    info(f"GET {url}")
    try:
        data = urllib.request.urlopen(url, timeout=10).read()
    except Exception as e:
        finish({"ok": False, "cmd": "escl-cap", "error": f"拉取失败: {e}", "elapsed_ms": int((time.time() - t0) * 1000)})
        return
    info(f"Capabilities {len(data)} bytes，耗时 {int((time.time()-t0)*1000)}ms")
    root = ET.fromstring(data)

    def tag(el):
        return el.tag.rsplit('}', 1)[-1]

    summary = {"ok": True, "cmd": "escl-cap", "elapsed_ms": int((time.time() - t0) * 1000)}
    platen = None
    for el in root.iter():
        if tag(el) == "Platen":
            platen = el
            break
    target = platen if platen is not None else root
    for el in target.iter():
        t = tag(el)
        if t in ("MaxWidth", "MaxHeight", "MinWidth", "MinHeight") and el.text and t not in summary:
            summary[t] = int(el.text)
        elif t == "XResolution" and el.text:
            summary.setdefault("resolutions", set()).add(el.text.strip())
        elif t == "ColorMode" and el.text:
            summary.setdefault("color_modes", set()).add(el.text.strip())
        elif t == "DocumentFormats" or t == "DocumentFormatExt":
            pass
    if "resolutions" in summary:
        summary["resolutions"] = sorted(summary["resolutions"])
    if "color_modes" in summary:
        summary["color_modes"] = sorted(summary["color_modes"])
    # 编码支持
    fmts = []
    for el in root.iter():
        if tag(el) in ("DocumentFormat", "DocumentFormatExt") and el.text:
            fmts.append(el.text.strip())
    summary["formats"] = sorted(set(fmts))
    bw, bh = scan_once.escl_caps(base)[2:4]
    summary["bed_300in"] = [bw, bh]
    info(f"平板 {bw}x{bh}（1/300 英寸）= {bw/300*2.54:.1f}x{bh/300*2.54:.1f}cm")
    finish(summary)


def cmd_escl(base, dpi, pixel, rows, cols, overlap):
    t0 = time.time()
    texts, meta = scan_once.escl_scan(dpi, pixel, base, rows, cols, overlap)
    finish({"ok": True, "texts": texts, "elapsed_ms": int((time.time() - t0) * 1000), **meta})


def cmd_wia(dpi, pixel, rows, cols, overlap):
    t0 = time.time()
    texts, meta = scan_once.wia_scan(dpi, pixel, None, rows, cols, overlap)
    finish({"ok": True, "texts": texts, "elapsed_ms": int((time.time() - t0) * 1000), **meta})


def main():
    argv = sys.argv[1:]
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return

    cmd = argv[0]

    def argval(flag, default):
        return argv[argv.index(flag) + 1] if flag in argv and argv.index(flag) + 1 < len(argv) else default

    base = argval("--base", "http://192.168.1.208/eSCL")
    dpi = int(argval("--dpi", "300"))
    pixel = argval("--pixel", "gray")
    rows, cols = scan_once.parse_tiles(argval("--tiles", "2x2"))
    overlap = float(argval("--overlap", "0.12"))

    try:
        if cmd == "escl-cap":
            cmd_escl_cap(base)
        elif cmd == "escl-stream":
            info(f"eSCL 流式早停（整面单 job，边收边解，{dpi}dpi {pixel}）")
            t0 = time.time()
            texts, meta = scan_once.escl_scan_stream(dpi, pixel, base)
            finish({"ok": True, "texts": texts, "elapsed_ms": int((time.time() - t0) * 1000), **meta})
        elif cmd == "escl-full":
            info(f"eSCL 整面 {dpi}dpi {pixel}（基线）")
            cmd_escl(base, dpi, pixel, 1, 1, 0)
        elif cmd == "escl-tiles":
            info(f"eSCL 分块 {rows}x{cols}，重叠 {int(overlap*100)}%，扫到即停")
            cmd_escl(base, dpi, pixel, rows, cols, overlap)
        elif cmd == "wia-full":
            info(f"WIA 整面 {dpi}dpi {pixel}（旧基线）")
            cmd_wia(dpi, pixel, 1, 1, 0)
        elif cmd == "wia-tiles":
            info(f"WIA 分块 {rows}x{cols}，重叠 {int(overlap*100)}%，扫到即停")
            cmd_wia(dpi, pixel, rows, cols, overlap)
        else:
            print(f"未知命令: {cmd}\n{__doc__}")
            sys.exit(1)
    except SystemExit:
        raise
    except Exception as e:
        finish({"ok": False, "cmd": cmd, "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()

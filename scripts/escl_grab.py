"""抓一张 eSCL 原图存盘（质量检查用，不入正式链路）。

用法: python escl_grab.py [dpi] [out.jpg]
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server", "python"))
sys.stdout.reconfigure(encoding="utf-8")
import time

import scan_once as s

BASE = "http://192.168.1.208/eSCL"
dpi = int(sys.argv[1]) if len(sys.argv) > 1 else 100
out = sys.argv[2] if len(sys.argv) > 2 else r"D:\CH341-SPI\flash-mgmt\scripts\escl_last.jpg"

style, version, bw, bh = s.escl_caps(BASE)
print(f"caps: style={style} version={version} bed={bw}x{bh}")
t0 = time.time()
job = s.escl_scan_job(BASE, style, version, dpi, "gray", 0, 0, bw, bh)
print(f"job: {job}")
data, ct = s.escl_fetch(job)
with open(out, "wb") as f:
    f.write(data)
s.escl_delete_job(job)
print(f"saved {out}: {len(data)} bytes, {ct}, {int((time.time()-t0)*1000)}ms")

"""流式早停实验：整面单 job + JPEG 渐进流边收边解，码行一到立即停止。

用户思路：eSCL 的 JPEG 是流式输出（一行行到达），不必等扫完——
收到的部分图能解出码就立刻 DELETE job 让扫描仪停下。

依赖 PIL 的 LOAD_TRUNCATED_IMAGES=True：截断 JPEG 也能 load 出已到达的行。
"""
import io
import sys
import time
import urllib.request

from PIL import Image, ImageFile

ImageFile.LOAD_TRUNCATED_IMAGES = True  # 允许解码未下完的 JPEG（已到达的行照常出图）

import numpy as np
import zxingcpp

BASE = "http://192.168.1.208/eSCL"
HP = "http://schemas.hp.com/imaging/escl/2011/05/03"
PWG = "http://www.pwg.org/schemas/2010/12/sm"
W, H, DPI = 2550, 3508, 300

XML = f"""<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="{HP}" xmlns:pwg="{PWG}">
  <pwg:Version>2.5</pwg:Version>
  <scan:Intent>Photo</scan:Intent>
  <pwg:ScanRegions>
    <pwg:ScanRegion>
      <pwg:Height>{H}</pwg:Height>
      <pwg:Width>{W}</pwg:Width>
      <pwg:XOffset>0</pwg:XOffset>
      <pwg:YOffset>0</pwg:YOffset>
    </pwg:ScanRegion>
  </pwg:ScanRegions>
  <pwg:InputSource>Platen</pwg:InputSource>
  <scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>
  <scan:XResolution>{DPI}</scan:XResolution>
  <scan:YResolution>{DPI}</scan:YResolution>
  <scan:ColorMode>Grayscale8</scan:ColorMode>
  <scan:CompressionFactor>85</scan:CompressionFactor>
</scan:ScanSettings>"""


def decode(buf):
    """累积 buffer → 尝试解码（截断 JPEG 取已到达部分）。失败返回 None。"""
    try:
        img = Image.open(io.BytesIO(bytes(buf)))
        img.load()
    except Exception:
        return None
    arr = np.asarray(img.convert("L"))
    try:
        results = zxingcpp.read_barcodes(arr)
    except Exception:
        return None
    texts, seen = [], set()
    for r in results:
        t = str(r.text)
        if t and t not in seen:
            seen.add(t)
            texts.append({"text": t, "format": str(r.format).split(".")[-1]})
    return texts


def main():
    t0 = time.time()
    req = urllib.request.Request(f"{BASE}/ScanJobs", data=XML.encode(),
                                 headers={"Content-Type": "text/xml"}, method="POST")
    r = urllib.request.urlopen(req, timeout=30)
    job = r.headers.get("Location")
    r.read()
    print(f"POST 201 {int((time.time()-t0)*1000)}ms job={job}")

    resp = urllib.request.urlopen(f"{job}/NextDocument", timeout=120)
    print(f"GET connected {resp.status} {resp.headers.get('Content-Type')}")

    buf = bytearray()
    last_try = 0.0
    hit = None
    tries = 0
    while True:
        chunk = resp.read1(65536)
        if not chunk:
            print(f"[{int((time.time()-t0)*1000)}ms] 流结束，共 {len(buf)}B")
            break
        buf += chunk
        now = time.time()
        if now - last_try >= 0.4:
            last_try = now
            tries += 1
            texts = decode(buf)
            if texts:
                hit = texts
                print(f"[{int((time.time()-t0)*1000)}ms] 命中！已收 {len(buf)}B（第 {tries} 次尝试解码）")
                break

    # 收尾：停机 + 删 job
    try:
        urllib.request.urlopen(urllib.request.Request(job, method="DELETE"), timeout=15)
        print(f"[{int((time.time()-t0)*1000)}ms] job deleted")
    except Exception as e:
        print(f"[{int((time.time()-t0)*1000)}ms] delete: {e}")

    if hit:
        print(f"RESULT: 命中 {hit} | 总耗时 {int((time.time()-t0)*1000)}ms | 只收了 {len(buf)}B")
    else:
        texts = decode(buf)
        print(f"RESULT: 流式未早停，整面 {len(buf)}B 兜底解码: {texts} | 总耗时 {int((time.time()-t0)*1000)}ms")


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()

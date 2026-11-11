"""流式模型验证：POST job → 立即 GET NextDocument（阻塞 read 到扫完）→ DELETE。

用户实锤：Processing 时 NextDocument 不报错，图片渐进加载（扫到哪传到哪）。
若 urlopen().read() 直接阻塞到拿到完整 JPEG，则连轮询都不需要。
"""
import sys
import time
import urllib.request

BASE = "http://192.168.1.208/eSCL"
HP = "http://schemas.hp.com/imaging/escl/2011/05/03"
PWG = "http://www.pwg.org/schemas/2010/12/sm"
W, H, DPI = 2550, 3508, 75

XML = f"""<scan:ScanSettings xmlns:scan="{HP}" xmlns:pwg="{PWG}">
  <pwg:Version>2.5</pwg:Version>
  <scan:Intent>Document</scan:Intent>
  <scan:ScanRegions>
    <scan:ScanRegion>
      <scan:ContentRegionUnits>ThreeHundredthsOfInches</scan:ContentRegionUnits>
      <scan:XOffset>0</scan:XOffset>
      <scan:YOffset>0</scan:YOffset>
      <scan:Width>{W}</scan:Width>
      <scan:Height>{H}</scan:Height>
    </scan:ScanRegion>
  </scan:ScanRegions>
  <scan:DocumentFormat>image/jpeg</scan:DocumentFormat>
  <scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>
  <scan:InputSource>Platen</scan:InputSource>
  <scan:XResolution>{DPI}</scan:XResolution>
  <scan:YResolution>{DPI}</scan:YResolution>
  <scan:ColorMode>Grayscale8</scan:ColorMode>
</scan:ScanSettings>"""


def main():
    t0 = time.time()
    req = urllib.request.Request(f"{BASE}/ScanJobs", data=XML.encode(),
                                 headers={"Content-Type": "text/xml"}, method="POST")
    r = urllib.request.urlopen(req, timeout=30)
    job = r.headers.get("Location")
    r.read()
    print(f"POST 201 {int((time.time()-t0)*1000)}ms job={job}")

    t1 = time.time()
    resp = urllib.request.urlopen(f"{job}/NextDocument", timeout=120)  # read() 阻塞到流尾
    print(f"GET connected {int((time.time()-t1)*1000)}ms status={resp.status} "
          f"type={resp.headers.get('Content-Type')} len={resp.headers.get('Content-Length')}")
    data = resp.read()
    print(f"read complete {len(data)} bytes, read 耗时 {int((time.time()-t1)*1000)}ms, 总 {int((time.time()-t0)*1000)}ms")

    with open("escl_stream_result.jpg", "wb") as f:
        f.write(data)

    urllib.request.urlopen(urllib.request.Request(job, method="DELETE"), timeout=15)
    print(f"deleted, total {int((time.time()-t0)*1000)}ms")


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()

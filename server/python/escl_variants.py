"""eSCL ScanSettings 变体矩阵实验——找出这台 HP 收哪个格式。

依次 POST 各变体：400/415 = 拒绝（无副作用，继续下一个）；201 = 接受，
立即走完 轮询→NextDocument→DELETE 全链路并打印耗时。
"""
import io
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

BASE = "http://192.168.1.208/eSCL"

HP = "http://schemas.hp.com/imaging/escl/2011/05/03"
PWG = "http://www.pwg.org/schemas/2010/12/sm"
APPLE = "http://schemas.apple.com/escl/1.0"

W, H = 2550, 3508  # 整面（1/300in）
DPI = 75


def v1():  # HP ns 全家 + scan: 几何 + 裸单位值
    return f"""<scan:ScanSettings xmlns:scan="{HP}" xmlns:pwg="{PWG}">
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


def v2():  # 同 V1，但单位值带 escl: 前缀
    return v1().replace("<scan:ContentRegionUnits>ThreeHundredthsOfInches",
                        "<scan:ContentRegionUnits>escl:ThreeHundredthsOfInches")


def v3():  # HP ns + pwg: 几何
    return f"""<scan:ScanSettings xmlns:scan="{HP}" xmlns:pwg="{PWG}">
  <pwg:Version>2.5</pwg:Version>
  <scan:Intent>Document</scan:Intent>
  <scan:ScanRegions>
    <scan:ScanRegion>
      <scan:ContentRegionUnits>ThreeHundredthsOfInches</scan:ContentRegionUnits>
      <pwg:XOffset>0</pwg:XOffset>
      <pwg:YOffset>0</pwg:YOffset>
      <pwg:Width>{W}</pwg:Width>
      <pwg:Height>{H}</pwg:Height>
    </scan:ScanRegion>
  </scan:ScanRegions>
  <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
  <scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>
  <scan:InputSource>Platen</scan:InputSource>
  <scan:XResolution>{DPI}</scan:XResolution>
  <scan:YResolution>{DPI}</scan:YResolution>
  <scan:ColorMode>Grayscale8</scan:ColorMode>
</scan:ScanSettings>"""


def v4():  # Apple ns + pwg:Version（标准 eSCL 写法）
    return f"""<scan:ScanSettings xmlns:scan="{APPLE}" xmlns:escl="{APPLE}" xmlns:pwg="{PWG}">
  <pwg:Version>2.0</pwg:Version>
  <scan:Intent>Document</scan:Intent>
  <scan:ScanRegions>
    <scan:ScanRegion>
      <scan:ContentRegionUnits>escl:ThreeHundredthsOfInches</scan:ContentRegionUnits>
      <scan:XOffset>0</scan:XOffset>
      <scan:YOffset>0</scan:YOffset>
      <scan:Width>{W}</scan:Width>
      <scan:Height>{H}</scan:Height>
    </scan:ScanRegion>
  </scan:ScanRegions>
  <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
  <scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>
  <scan:InputSource>Platen</scan:InputSource>
  <scan:XResolution>{DPI}</scan:XResolution>
  <scan:YResolution>{DPI}</scan:YResolution>
  <scan:ColorMode>Grayscale8</scan:ColorMode>
</scan:ScanSettings>"""


def post(xml):
    req = urllib.request.Request(f"{BASE}/ScanJobs", data=xml.encode("utf-8"),
                                 headers={"Content-Type": "text/xml"}, method="POST")
    try:
        return urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as e:
        return e


def job_state(job):
    try:
        root = ET.fromstring(urllib.request.urlopen(job, timeout=15).read())
        for el in root.iter():
            if el.tag.rsplit("}", 1)[-1] == "JobState" and el.text:
                return el.text.strip()
    except Exception as e:
        return f"(poll err: {e})"
    return "?"


def main():
    for name, fn in [("V1 hp-scan-geom", v1), ("V2 hp+escl-prefix", v2),
                     ("V3 hp-pwg-geom", v3), ("V4 apple-std", v4)]:
        t0 = time.time()
        r = post(fn())
        ms = int((time.time() - t0) * 1000)
        loc = r.headers.get("Location", "")
        body = r.read().decode("utf-8", "replace")
        print(f"{name}: HTTP {r.code} ({ms}ms) Location={loc}")
        if body.strip():
            print(f"  body: {body.strip()[:300]}")
        if r.code in (200, 201) and loc:
            job = loc if loc.startswith("http") else BASE + (loc if loc.startswith("/") else "/" + loc)
            # 轮询到 Completed
            t1 = time.time()
            state = "?"
            while time.time() - t1 < 30:
                state = job_state(job)
                if state in ("Completed", "Aborted", "Canceled"):
                    break
                time.sleep(0.5)
            print(f"  job: {state} after {int((time.time()-t1)*1000)}ms")
            if state == "Completed":
                t2 = time.time()
                data = urllib.request.urlopen(f"{job}/NextDocument", timeout=60).read()
                print(f"  image: {len(data)} bytes ({int((time.time()-t2)*1000)}ms)")
            urllib.request.urlopen(urllib.request.Request(job, method="DELETE"), timeout=15)
            print("  job deleted")
            print(f"\nWINNER = {name}")
            return
        print()
    print("ALL VARIANTS REJECTED")


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()

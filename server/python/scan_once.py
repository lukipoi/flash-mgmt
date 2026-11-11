"""扫描仪单次扫描 + 条码/二维码解码（flash-mgmt 后端辅助脚本）。

由 Nitro 通过 `python -X utf8 scan_once.py --scan ...` 调用（server/utils/scannerRuntime.ts），
结果以 UTF-8 JSON 输出到 stdout，不落盘、不常驻（避免独立服务进程）。

三种扫描路径：
  1. WIA 分块扫到即停（默认 tiles） 整面划 R×C 块，逐块扫+解码，命中立即返回；
     全部未中再整面兜底一次。码位置不固定时的提速方案。
     切码防护三层：① 块间 12% 重叠（A4 约 2.5cm，跨中线的大码也必在某块内完整）
     ② 全块未中自动整面兜底（正确性保底，最差等于旧整面）③ overlap 可调。
  2. WIA 整面（--mode full）        旧行为，A4 全幅最慢。
  3. eSCL 直连（--escl URL）        Apple AirScan HTTP 协议，网络直连打印机不走 USB。
                                    实测 HP DeskJet：http://192.168.1.208/eSCL（无认证）。
                                    主力 = 整面 + 200dpi（真机 6~8s；150dpi 虽 3~4s 但
                                    清晰度用户验收不过关）。DELETE 不刹
                                    小车 → 流式早停只有感知收益、固定区域总行程不赚，
                                    均实验后弃用（代码保留：--region 固定区域快扫仍可用）。
                                    HP 私有 ns + Webscan 逆向配方（见 escl_scan_settings）。

依赖：pywin32、Pillow、numpy、zxing-cpp（本机全局 Python 已装齐）；
eSCL 路径纯标准库 HTTP，无额外依赖。解码统一 zxing-cpp 离线引擎。
"""
import io
import json
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path


def out(obj, code=0):
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(code)


def log(level, msg):
    """进度日志走 stderr（[INFO]/[WARN]），stdout 只留最终 JSON。"""
    print(f"[{level}] {msg}", file=sys.stderr)


# WIA 图像格式 GUID（BMP 兼容性最好）
WIA_FORMAT_BMP = "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}"
# WIA_INTENT 色彩意图：1=彩色 2=灰度 4=黑白(文本)
_INTENT = {"color": 1, "gray": 2, "bw": 4}
# WIA_IPA_DATATYPE：1=彩色 2=灰度 3=黑白（部分 HP 驱动更认 Datatype，两处都设）
_DATATYPE = {"color": 1, "gray": 2, "bw": 3}
# eSCL ColorMode（HP capabilities 实测清单：Grayscale8/RGB24；bw 走 Grayscale8）
_ESCL_COLOR = {"color": "RGB24", "gray": "Grayscale8", "bw": "Grayscale8"}
# HP 私有 eSCL 命名空间（schemas.apple.com 的标准 ns 这台 HP 不认，实测 400）
_HP_ESCL_NS = "http://schemas.hp.com/imaging/escl/2011/05/03"
_PWG_NS = "http://www.pwg.org/schemas/2010/12/sm"
_APPLE_ESCL_NS = "http://schemas.apple.com/escl/1.0"


def decode_gray(img):
    """PIL Image → zxing 解码结果列表（去重）。"""
    import numpy as np
    import zxingcpp

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
    return texts


def tile_regions(h0, v0, rows, cols, overlap):
    """整面 extent 划 R×C 块，块间 overlap 比例重叠防切码。

    返回 [(x, y, w, h), ...]，顺序：从上到下、从左到右。
    """
    cw, ch = h0 // cols, v0 // rows
    ox, oy = int(cw * overlap), int(ch * overlap)
    regions = []
    for r in range(rows):
        for c in range(cols):
            x = max(0, c * cw - ox)
            y = max(0, r * ch - oy)
            w = min(h0 - x, cw + 2 * ox)
            h = min(v0 - y, ch + 2 * oy)
            regions.append((x, y, w, h))
    return regions


# ---------------------------------------------------------------- WIA 路径

def wia_connect(name=None):
    import win32com.client

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
    return device.Items[1]  # 1-based：平板扫描面


def _getp(item, prop_name):
    try:
        return int(item.Properties[prop_name].Value)
    except Exception:
        return None


def _setp_hard(item, prop_name, value):
    """区域相关属性必须设置成功（失败要显式暴露，不能像软设置那样静默吞）。"""
    try:
        item.Properties[prop_name].Value = value
        return True
    except Exception as e:
        log("WARN", f"设置 {prop_name}={value} 失败: {e}")
        return False


def wia_transfer(item):
    from PIL import Image

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td) / "scan.bmp"
        image_file = item.Transfer(WIA_FORMAT_BMP)
        image_file.SaveFile(str(tmp))
        img = Image.open(tmp)
        img.load()  # 强制读入内存，临时目录随即销毁
    return img


def wia_scan(dpi, pixel, name, rows, cols, overlap):
    """WIA 扫描。分块模式逐块扫+解码，命中即停；全部未中再整面兜底一次。"""
    item = wia_connect(name)

    def setp(prop_name, value):
        try:
            item.Properties[prop_name].Value = value
        except Exception:
            pass  # 驱动不暴露该属性时静默忽略

    setp("Horizontal Resolution", int(dpi))
    setp("Vertical Resolution", int(dpi))
    setp("Current Intent", _INTENT.get(pixel, 2))
    setp("Datatype", _DATATYPE.get(pixel, 2))

    h0 = _getp(item, "Horizontal Extent")  # 当前 DPI 下整面宽（像素）
    v0 = _getp(item, "Vertical Extent")
    t0 = time.time()

    if rows * cols > 1:
        if not h0 or not v0:
            log("WARN", "读不到整面 Extent，无法分块，退整面扫")
        else:
            log("INFO", f"整面 {h0}x{v0}px@{dpi}dpi，分 {rows}x{cols} 块（重叠 {int(overlap*100)}%）")
            for idx, (x, y, w, h) in enumerate(tile_regions(h0, v0, rows, cols, overlap)):
                ok = all([
                    _setp_hard(item, "Horizontal Start Position", x),
                    _setp_hard(item, "Vertical Start Position", y),
                    _setp_hard(item, "Horizontal Extent", w),
                    _setp_hard(item, "Vertical Extent", h),
                ])
                if not ok:
                    log("WARN", f"块 {idx + 1} 区域设置失败，跳过该块")
                    continue
                log("INFO", f"扫块 {idx + 1}/{rows * cols}: ({x},{y}) {w}x{h}")
                texts = decode_gray(wia_transfer(item))
                if texts:
                    log("INFO", f"块 {idx + 1} 命中 {len(texts)} 条，停止")
                    return texts, {"mode": "wia_tiles", "tile": idx, "tiles": f"{rows}x{cols}"}
            log("INFO", "分块全部未命中，整面兜底扫一次")

    texts = decode_gray(wia_transfer(item))
    return texts, {"mode": "wia_full", "tile": None, "tiles": None}


# ---------------------------------------------------------------- eSCL 路径

def _http(url, method="GET", data=None, headers=None, timeout=30):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    return urllib.request.urlopen(req, timeout=timeout)


def _tag(el):
    return el.tag.rsplit("}", 1)[-1]


def escl_caps(base):
    """拉 ScannerCapabilities：返回 (style, version, bw, bh)。

    style='hp'（HP 私有 ns，实测该 HP 用 apple ns 一律 400/无视参数）
    style='std'（Apple 标准 eSCL）。bw/bh 单位 1/300 英寸。
    """
    try:
        root = ET.fromstring(_http(f"{base}/ScannerCapabilities", timeout=10).read())
    except Exception as e:
        log("WARN", f"拉 ScannerCapabilities 失败（{e}），按 A4 竖版 2481x3507 估算")
        return "std", "2.0", 2481, 3507

    style = "hp" if "hp.com" in root.tag else "std"
    version = "2.5" if style == "hp" else "2.0"

    def find_int(root_el, name):
        for el in root_el.iter():
            if _tag(el) == name and el.text:
                try:
                    return int(el.text)
                except (TypeError, ValueError):
                    pass
        return None

    for v in root.iter():
        if _tag(v) == "Version" and v.text:
            version = v.text.strip()
            break

    platen = next((el for el in root.iter() if _tag(el) == "Platen"), None)
    target = platen if platen is not None else root
    bw = find_int(target, "MaxWidth")
    bh = find_int(target, "MaxHeight")
    if not (bw and bh):
        bw, bh = 2481, 3507
        log("WARN", "Capabilities 无尺寸信息，按 A4 竖版 2481x3507 估算")
    log("INFO", f"eSCL[{style}] 平板 {bw}x{bh}（1/300in）")
    return style, version, bw, bh


def escl_scan_settings(style, version, dpi, pixel, x, y, w, h):
    """构造 ScanSettings XML。区域单位 1/300 英寸。

    HP 配方来自逆向 Webscan 前端（WebScanEscl.js 的 schema 映射），真机 E4 实验：
      - pwg:Version 缺失 → 409；几何必须 pwg: 前缀（scan: 会被无视→整面硬扫 18s）
      - 格式只认 scan:DocumentFormatExt（DocumentFormat 无效），要 jpeg 还得
        scan:Intent=Photo + scan:CompressionFactor（Webscan jpg 模式即此组合）
      - 生效后区域连机械行程一起缩短：整面 18s → 7x9cm 3.1s
    """
    color = _ESCL_COLOR.get(pixel, "Grayscale8")
    if style == "hp":
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="{_HP_ESCL_NS}" xmlns:pwg="{_PWG_NS}">
  <pwg:Version>{version}</pwg:Version>
  <scan:Intent>Photo</scan:Intent>
  <pwg:ScanRegions>
    <pwg:ScanRegion>
      <pwg:Height>{h}</pwg:Height>
      <pwg:Width>{w}</pwg:Width>
      <pwg:XOffset>{x}</pwg:XOffset>
      <pwg:YOffset>{y}</pwg:YOffset>
    </pwg:ScanRegion>
  </pwg:ScanRegions>
  <pwg:InputSource>Platen</pwg:InputSource>
  <scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>
  <scan:XResolution>{int(dpi)}</scan:XResolution>
  <scan:YResolution>{int(dpi)}</scan:YResolution>
  <scan:ColorMode>{color}</scan:ColorMode>
  <scan:CompressionFactor>85</scan:CompressionFactor>
</scan:ScanSettings>"""
    # 标准 Apple eSCL
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<ScanSettings xmlns="{_APPLE_ESCL_NS}" xmlns:escl="{_APPLE_ESCL_NS}">
  <Intent>Document</Intent>
  <ScanRegions>
    <ScanRegion>
      <ContentRegionUnits>escl:ThreeHundredthsOfInches</ContentRegionUnits>
      <XOffset>{x}</XOffset>
      <YOffset>{y}</YOffset>
      <Width>{w}</Width>
      <Height>{h}</Height>
    </ScanRegion>
  </ScanRegions>
  <InputSource>Platen</InputSource>
  <XResolution>{int(dpi)}</XResolution>
  <YResolution>{int(dpi)}</YResolution>
  <ColorMode>{color}</ColorMode>
  <DocumentFormatExt>image/jpeg</DocumentFormatExt>
</ScanSettings>"""


def escl_scan_job(base, style, version, dpi, pixel, x, y, w, h):
    """创建一个 eSCL ScanJob，返回 job URL。"""
    xml = escl_scan_settings(style, version, dpi, pixel, x, y, w, h)
    resp = _http(
        f"{base}/ScanJobs",
        method="POST",
        data=xml.encode("utf-8"),
        headers={"Content-Type": "text/xml"},
        timeout=30,
    )
    loc = resp.headers.get("Location")
    body = resp.read().decode("utf-8", "replace")
    if loc:
        return urllib.parse.urljoin(base + "/", loc)
    # 兜底：有的机器不放 Location，从响应体 XML 里找 JobUri
    for el in ET.fromstring(body).iter():
        if _tag(el) == "JobUri" and el.text:
            return urllib.parse.urljoin(base + "/", el.text.strip())
    raise RuntimeError("ScanJob 创建成功但拿不到 JobUri（无 Location 头也无 JobUri 元素）")


def escl_fetch(job_url, max_wait=45.0):
    """拉取扫描图，返回 (bytes, content_type)。

    HP 实测为流式长连接：job 建立后立即可 GET，连接挂着不动，
    数据随扫描进度渐进到达，read() 阻塞到扫完才返回（用户实锤）。
    开头短暂 404/409 时小重试兜底。
    """
    t0 = time.time()
    last = None
    while time.time() - t0 < max_wait:
        try:
            resp = _http(f"{job_url}/NextDocument", timeout=120,
                         headers={"Accept": "image/jpeg"})
            return resp.read(), resp.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (404, 409, 425, 503):
                time.sleep(0.5)  # 任务未就绪/设备忙，继续等
                continue
            raise RuntimeError(f"NextDocument HTTP {e.code}")
        except Exception as e:
            last = e
            time.sleep(0.5)
    raise RuntimeError(f"NextDocument {max_wait:.0f}s 内未就绪: {last}")


def escl_delete_job(job_url):
    try:
        _http(job_url, method="DELETE", timeout=15)
    except Exception as e:
        log("WARN", f"清理 ScanJob 失败（不影响结果）: {e}")


def _decode_partial(buf):
    """截断 JPEG 部分解码（LOAD_TRUNCATED_IMAGES：已到达的行照常出图）。

    返回解码结果列表；JPEG 头未收齐/解码失败返回 None（继续等更多数据）。
    """
    from PIL import Image, ImageFile
    ImageFile.LOAD_TRUNCATED_IMAGES = True
    try:
        img = Image.open(io.BytesIO(buf))
        img.load()
    except Exception:
        return None
    return decode_gray(img)


def escl_scan_stream(dpi, pixel, base):
    """流式早停扫描（eSCL 主力路径，真机完胜分块方案）。

    单个整面 job：JPEG 流从上往下一行行到达，每 0.4s 拿累积 buffer
    试解码一次，码的行一到立即停（DELETE job 让扫描仪停机）。
    实测 HP DeskJet：码在顶部 3.6s/47KB，中下部 6.5s/111KB，
    最坏（码在最底）= 整面一次 7.7s——无分块的重复行程与多次预热。
    """
    base = base.rstrip("/")
    style, version, bw, bh = escl_caps(base)
    job = escl_scan_job(base, style, version, dpi, pixel, 0, 0, bw, bh)
    t0 = time.time()
    try:
        resp = _http(f"{job}/NextDocument", timeout=120,
                     headers={"Accept": "image/jpeg"})
        buf = bytearray()
        last_try = 0.0
        while True:
            chunk = resp.read1(65536)
            if not chunk:
                log("INFO", f"流结束，共收 {len(buf)}B")
                break
            buf += chunk
            now = time.time()
            if now - last_try >= 0.4:
                last_try = now
                texts = _decode_partial(bytes(buf))
                if texts:
                    log("INFO", f"流式命中！只收 {len(buf)}B/{int((time.time()-t0)*1000)}ms，停机")
                    return texts, {"mode": "escl_stream", "tile": None, "tiles": None}
        # 流自然结束 = 整面扫完，兜底解码
        texts = _decode_partial(bytes(buf)) or []
        return texts, {"mode": "escl_full", "tile": None, "tiles": None}
    finally:
        escl_delete_job(job)


def escl_scan_region(dpi, pixel, base, region):
    """固定区域快扫（主力方案，真机验证行程随区域缩短：整面 7.7s → 1/4 面 ~3s）。

    region = "fx,fy,fw,fh"（0~1 比例）。先扫固定区域（小车只走对应行程），
    未命中自动整面兜底一次（最坏 = 区域+整面，仍快于旧 WIA 整面 15s）。
    DELETE 不刹机械行程（真机实测），故不做流式早停花活——区域图阻塞取完即解。
    """
    from PIL import Image

    base = base.rstrip("/")
    style, version, bw, bh = escl_caps(base)
    try:
        fx, fy, fw, fh = [float(v) for v in region.split(",")]
        assert 0 <= fx < 1 and 0 <= fy < 1 and 0 < fw <= 1 and 0 < fh <= 1
    except Exception:
        raise RuntimeError(f"--region '{region}' 不合法（应为 fx,fy,fw,fh，各 0~1）")

    def do_region(x, y, w, h):
        job = escl_scan_job(base, style, version, dpi, pixel, x, y, w, h)
        try:
            data, ctype = escl_fetch(job)
        finally:
            escl_delete_job(job)
        if "pdf" in ctype:
            raise RuntimeError("打印机回的是 PDF 而非 JPEG（该固件不吃 DocumentFormatExt 配方）")
        return Image.open(io.BytesIO(data))

    rx, ry, rw, rh = round(fx * bw), round(fy * bh), round(fw * bw), round(fh * bh)
    t0 = time.time()
    log("INFO", f"区域快扫 ({fx},{fy},{fw},{fh}) = ({rx},{ry}) {rw}x{rh}")
    texts = decode_gray(do_region(rx, ry, rw, rh))
    if texts:
        log("INFO", f"区域命中 {len(texts)} 条（{int((time.time()-t0)*1000)}ms）")
        return texts, {"mode": "escl_region", "tile": None, "tiles": region}
    log("INFO", f"区域未命中（{int((time.time()-t0)*1000)}ms），整面兜底扫一次")
    texts, meta = escl_scan_stream(dpi, pixel, base)
    meta["mode"] = "escl_region_fallback"
    meta["tiles"] = region
    return texts, meta


def escl_scan(dpi, pixel, base, rows, cols, overlap):
    """eSCL 分块扫描（备选保留；主力见 escl_scan_stream）。"""
    from PIL import Image

    base = base.rstrip("/")
    style, version, bw, bh = escl_caps(base)

    def do_region(x, y, w, h):
        job = escl_scan_job(base, style, version, dpi, pixel, x, y, w, h)
        try:
            data, ctype = escl_fetch(job)
        finally:
            escl_delete_job(job)
        if "pdf" in ctype:
            raise RuntimeError("打印机回的是 PDF 而非 JPEG（该固件不吃 DocumentFormatExt 配方）")
        return Image.open(io.BytesIO(data))

    if rows * cols > 1:
        log("INFO", f"eSCL 整面 {bw}x{bh}（1/300in），分 {rows}x{cols} 块")
        for idx, (fx, fy, fw, fh) in enumerate(tile_regions(bw, bh, rows, cols, overlap)):
            log("INFO", f"扫块 {idx + 1}/{rows * cols}: ({fx},{fy}) {fw}x{fh}")
            try:
                texts = decode_gray(do_region(fx, fy, fw, fh))
            except Exception as e:
                log("WARN", f"块 {idx + 1} 失败（继续下一块）: {e}")
                continue
            if texts:
                log("INFO", f"块 {idx + 1} 命中 {len(texts)} 条，停止")
                return texts, {"mode": "escl_tiles", "tile": idx, "tiles": f"{rows}x{cols}"}
        log("INFO", "分块全部未命中，整面兜底扫一次")

    texts = decode_gray(do_region(0, 0, bw, bh))
    return texts, {"mode": "escl_full", "tile": None, "tiles": None}


# ---------------------------------------------------------------- 入口

def list_scanners():
    import win32com.client

    dm = win32com.client.Dispatch("WIA.DeviceManager")
    scanners = []
    for info in dm.DeviceInfos:
        if info.Type == 1:  # ScannerDeviceType
            scanners.append({"id": info.DeviceID, "name": info.Properties["Name"].Value})
    out({"ok": True, "scanners": scanners})


def parse_tiles(s, default="2x2"):
    try:
        r, c = s.lower().split("x")
        return max(1, int(r)), max(1, int(c))
    except Exception:
        log("WARN", f"--tiles '{s}' 不合法（应为 RxC，如 2x2），用默认 {default}")
        r, c = default.split("x")
        return int(r), int(c)


def run_scan(dpi, pixel, name, escl, mode, tiles_s, overlap, region=None):
    t0 = time.time()
    rows, cols = parse_tiles(tiles_s)
    if escl:
        if region:
            # 主力：固定区域快扫 + 整面兜底（行程随区域缩短，DELETE 不刹机械故无流式花活）
            texts, meta = escl_scan_region(dpi, pixel, escl, region)
        else:
            # 主力：整面单 job（100dpi 实测 ~4.1s；码位置随意。DELETE 不刹小车，流式早停只有感知收益）
            texts, meta = escl_scan_stream(dpi, pixel, escl)
    else:
        if mode == "full":
            rows = cols = 1  # 强制单块 = 旧整面行为
        texts, meta = wia_scan(dpi, pixel, name, rows, cols, overlap)
    out({
        "ok": True,
        "texts": texts,
        "elapsed_ms": int((time.time() - t0) * 1000),
        **meta,
    })


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
        out({"ok": False, "error": "用法: scan_once.py --list | --scan [--dpi N] [--pixel gray|color|bw] "
                                   "[--name 关键词] [--escl http://ip[:port]/eSCL] [--mode tiles|full] "
                                   "[--tiles RxC] [--overlap 0.12]"}, 1)
        return

    def argval(flag, default=None):
        return argv[argv.index(flag) + 1] if flag in argv and argv.index(flag) + 1 < len(argv) else default

    dpi = int(argval("--dpi", "300"))
    pixel = argval("--pixel", "gray")
    name = argval("--name")
    escl = argval("--escl")
    mode = argval("--mode", "tiles")
    tiles = argval("--tiles", "2x2")
    overlap = float(argval("--overlap", "0.12"))
    region = argval("--region")

    try:
        run_scan(dpi, pixel, name, escl, mode, tiles, overlap, region)
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

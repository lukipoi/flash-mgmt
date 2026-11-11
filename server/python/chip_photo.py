"""扫一张芯片原件照（整面 200dpi 彩色 → PIL 自动裁白边 → JPEG 落盘）。

双路径，与扫码快扫同源：
  --escl http://ip/eSCL  → eSCL 网络直连打印机（复用 scan_once 的 escl_* 函数）
  无 --escl              → WIA 本机扫描仪（wia_connect + wia_transfer，返回 PIL 图）

stdout 只留最终 JSON，进度走 stderr。
用法: python chip_photo.py --out D:\\...\\chip-1.jpg [--escl http://ip/eSCL | --name 关键词] [--dpi 200]
输出: {"ok": true, "path": ..., "width": W, "height": H, "cropped": bool, "elapsed_ms": N}
"""
import argparse
import io
import json
import sys
import time

import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import scan_once as s  # noqa: E402


def scan_image(escl, name, dpi):
    """按路径扫一整面，返回 PIL RGB 图。"""
    if escl:
        style, version, bw, bh = s.escl_caps(escl)
        print(f"[INFO] caps: style={style} version={version} bed={bw}x{bh}", file=sys.stderr)
        job = s.escl_scan_job(escl, style, version, dpi, "color", 0, 0, bw, bh)
        try:
            data, ct = s.escl_fetch(job)
        finally:
            try:
                s.escl_delete_job(job)
            except Exception:
                pass
        print(f"[INFO] fetched {len(data)} bytes ({ct})", file=sys.stderr)
        from PIL import Image
        img = Image.open(io.BytesIO(data))
        img.load()
        return img

    # WIA 路径：属性设置与 scan_once.wia_scan 同款
    item = s.wia_connect(name)

    def setp(prop_name, value):
        try:
            item.Properties[prop_name].Value = value
        except Exception:
            pass  # 驱动不暴露该属性时静默忽略

    setp("Horizontal Resolution", int(dpi))
    setp("Vertical Resolution", int(dpi))
    setp("Current Intent", s._INTENT.get("color", 2))
    setp("Datatype", s._DATATYPE.get("color", 2))
    return s.wia_transfer(item)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="输出 JPEG 路径")
    ap.add_argument("--escl", help="eSCL 基址（给了走网络直连，否则走 WIA）")
    ap.add_argument("--name", help="WIA 设备名关键词（可选）")
    ap.add_argument("--dpi", type=int, default=200)
    args = ap.parse_args()

    t0 = time.time()
    img = scan_image(args.escl, args.name, args.dpi)
    if img.mode != "RGB":
        img = img.convert("RGB")

    # 自动裁白边：灰度 <235 视为内容（芯片丝印朝下时黑塑料是绝对主体）
    gray = img.convert("L")
    mask = gray.point(lambda p: 255 if p < 235 else 0)
    bbox = mask.getbbox()
    cropped = False
    if bbox:
        pad = 40  # 留 40px 边距，别贴死
        x0, y0, x1, y1 = bbox
        x0 = max(0, x0 - pad)
        y0 = max(0, y0 - pad)
        x1 = min(img.width, x1 + pad)
        y1 = min(img.height, y1 + pad)
        if (x1 - x0) < img.width or (y1 - y0) < img.height:
            img = img.crop((x0, y0, x1, y1))
            cropped = True

    img.save(args.out, "JPEG", quality=88)
    sys.stdout.write(json.dumps({
        "ok": True,
        "path": args.out,
        "width": img.width,
        "height": img.height,
        "cropped": cropped,
        "elapsed_ms": int((time.time() - t0) * 1000),
    }))


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()


def _project_root():
    import os
    from pathlib import Path
    env = os.environ.get("PROJECT_ROOT", "").strip()
    if env:
        return Path(env)
    here = Path(__file__).resolve().parent
    for cand in [here, *here.parents]:
        if (cand / "package.json").exists():
            return cand
    raise RuntimeError("PROJECT_ROOT not found")
_ROOT = _project_root()
PROJECT_ROOT = str(_ROOT)
# [位置:tests/unit/test_view_image_size.py] [yun-mcp-v2 view_image：读图片宽高 + 超过 max_width / max_height 才缩] [10-28] [注释时间 2026-10-28]
import os, struct, sys, tempfile, zlib, io
sys.path.insert(0, os.path.join(PROJECT_ROOT, 'yun-mcp-v2'))
os.chdir(os.path.join(PROJECT_ROOT, 'yun-mcp-v2'))
import mcp_server as m
from pathlib import Path
tmp = Path(tempfile.mkdtemp(prefix='vi-'))
bad = False
def check(c, msg):
    global bad
    print(('PASS ' if c else 'FAIL ') + msg)
    if not c: bad = True
def png(w, h):
    def ch(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    raw = b''.join(b'\x00' + bytes([200, 220, 255]) * w for _ in range(h))
    return b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw)) + ch(b'IEND', b'')
for w, h in [(1554, 1080), (390, 844), (200, 200)]:
    f = tmp / f'a{w}.png'; f.write_bytes(png(w, h)); check(m._img_size(f) == (w, h), f'png 宽高 {w}x{h}')
g = tmp / 'a.gif'; g.write_bytes(b'GIF89a' + struct.pack('<HH', 321, 123) + b'\x00' * 20); check(m._img_size(g) == (321, 123), 'gif 宽高')
wp = tmp / 'x.webp'; wp.write_bytes(b'RIFF' + b'\x00' * 4 + b'WEBPVP8X' + b'\x0a\x00\x00\x00' + b'\x00\x00\x00\x00' + (999).to_bytes(3, 'little') + (499).to_bytes(3, 'little') + b'\x00' * 10)
check(m._img_size(wp) == (1000, 500), 'webp(VP8X) 宽高')
# jpeg：用浏览器截一张真的
jp = tmp / 'p.jpg'
import subprocess, json
r = subprocess.run([sys.executable, str(m.SHOT_WORKER), json.dumps({'mode': 'page', 'url': 'data:text/html,<body style="background:#8af">x</body>', 'width': 640, 'height': 360, 'out': str(jp)})], capture_output=True, text=True, timeout=60)
check('OK' in r.stdout and m._img_size(jp) == (640, 360), 'jpeg 宽高（真截的 640x360）')
check(m._img_size(tmp / 'nope.png') is None, '不存在/读不出返回 None')
# view_image：没超上限 → 原样；超 max_width → 缩小；超 max_height → 缩小；两边都限
def dims(img):
    f = tmp / 'out.bin'; f.write_bytes(img.data); return m._img_size(f) if img.data[:2] == b'\xff\xd8' else None
import mcp_server
small = tmp / 'a390.png'
img = m.view_image(str(small)); check(img.path is not None or img.data, '小图（390x844）原样返回')
big = tmp / 'a1554.png'
img = m.view_image(str(big), max_width=800); d = dims(img); check(d and d[0] <= 800 and abs(d[0] / d[1] - 1554 / 1080) < 0.02, f'宽 1554 > max_width=800：等比缩到 {d}')
img = m.view_image(str(big), max_width=2400, max_height=400); d = dims(img); check(d and d[1] <= 400 and abs(d[0] / d[1] - 1554 / 1080) < 0.02, f'高 1080 > max_height=400：等比缩到 {d}')
img = m.view_image(str(big), max_width=2400, max_height=4000); check(getattr(img, 'path', None) is not None or img.data[:8] == b'\x89PNG\r\n\x1a\n', '没超两个上限：原样返回（不重新压缩）')
print('RESULT', 'FAIL' if bad else 'ALL PASS')

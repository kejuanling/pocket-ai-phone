#!/usr/bin/env python3
"""日记时间行回填（2026-10-22，需求追加 #16）。

把时间线里 kind=diary 的 assistant 消息，从旧格式
    [DIARY]正文[/DIARY]
改成新格式（与 lib/diary.js wrapDiaryTag 一致）
    （YYYY-MM-DD HH:MM diary）
    [DIARY]正文[/DIARY]
时间取该消息自己的 time 字段（Asia/Shanghai）。

- 幂等：已带时间行的跳过；role 不是 assistant 的（如 developer 的「[小世界] 涵写了日记」通知）不动；
  内容不是整条 [DIARY]…[/DIARY] 的不动。
- 默认 dry-run，只打印将改动的数量与样例；加 --apply 才写盘。
- --apply 时：每个有改动的文件先整份复制到备份目录，再 tmp + rename 原子替换。
用法：
    python3 scripts/backfill_diary_head.py            # 预演
    python3 scripts/backfill_diary_head.py --apply    # 执行
"""
import datetime
import glob
import json
import os
import re
import shutil
import sys
import zoneinfo

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TL_DIR = os.path.join(BASE, "timeline_data")
BACKUP_DIR = os.path.join(BASE, "data", "backups", "batchC-small-20261022", "timeline_data")
TZ = zoneinfo.ZoneInfo("Asia/Shanghai")
HEAD_RE = re.compile(r"^\s*（\d{4}-\d{2}-\d{2} \d{2}:\d{2} diary）")
WRAPPED_RE = re.compile(r"^\s*\[DIARY\][\s\S]*\[/DIARY\]\s*$")


def stamp(t):
    d = datetime.datetime.fromisoformat(str(t).replace("Z", "+00:00"))
    if d.tzinfo is None:
        d = d.replace(tzinfo=datetime.timezone.utc)
    return d.astimezone(TZ).strftime("%Y-%m-%d %H:%M")


def indent_of(raw):
    """沿用原文件缩进（网关 JSON.stringify(…, null, 1) 为 1 空格；紧凑文件则无缩进）。"""
    m = re.match(r"\[\n( +)", raw)
    return len(m.group(1)) if m else None


def dump(arr, raw):
    ind = indent_of(raw)
    out = json.dumps(arr, ensure_ascii=False, indent=ind, separators=None if ind else (",", ":"))
    return out + ("\n" if raw.endswith("\n") else "")


def main():
    apply = "--apply" in sys.argv
    total = skipped_done = skipped_other = no_time = 0
    changed_files = 0
    samples = []
    for f in sorted(glob.glob(os.path.join(TL_DIR, "enhanced_messages*.json"))):
        with open(f, encoding="utf-8") as fh:
            raw = fh.read()
        try:
            arr = json.loads(raw)
        except Exception as e:
            print("跳过（JSON 解析失败）", f, e)
            continue
        if not isinstance(arr, list):
            continue
        n = 0
        for m in arr:
            if not isinstance(m, dict) or m.get("kind") != "diary" or m.get("role") != "assistant":
                continue
            c = m.get("content")
            if not isinstance(c, str):
                skipped_other += 1
                continue
            if HEAD_RE.match(c):
                skipped_done += 1
                continue
            if not WRAPPED_RE.match(c):
                skipped_other += 1
                continue
            if not m.get("time"):
                no_time += 1
                continue
            m["content"] = "（" + stamp(m["time"]) + " diary）\n" + c.strip()
            n += 1
            total += 1
            if len(samples) < 3:
                samples.append((os.path.basename(f), m["content"][:70].replace("\n", "⏎")))
        if n:
            changed_files += 1
            if apply:
                os.makedirs(BACKUP_DIR, exist_ok=True)
                shutil.copy2(f, os.path.join(BACKUP_DIR, os.path.basename(f)))
                tmp = f + ".tmp-backfill"
                with open(tmp, "w", encoding="utf-8") as fh:
                    fh.write(dump(arr, raw))
                os.replace(tmp, f)
    print(("【已写盘】" if apply else "【预演，未写盘】"),
          "将回填 %d 条 / %d 个文件；已带时间行跳过 %d；非日记格式跳过 %d；缺 time 跳过 %d" % (total, changed_files, skipped_done, skipped_other, no_time))
    for s in samples:
        print("  样例", s)


if __name__ == "__main__":
    main()

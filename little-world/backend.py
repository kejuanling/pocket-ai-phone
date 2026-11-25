#!/usr/bin/env python3
"""
小世界 · 统一后端服务
端口: 8777
合并模块: 用户日记, 五子棋, 助手笔记, 月历, 待办/心动/记忆桶
数据文件保留在原目录
"""

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
import os, json, datetime, csv, io, sys, re, urllib.request, math, hashlib, uuid, threading
import numpy as np
from flask import Flask, Blueprint, request, jsonify, send_from_directory

app = Flask(__name__)

# ============================================================
# 0. gateway 内部事件回调（2026-09-19 批6 D4）
# 用户写日记 / 经期开始结束时，把事件推给 gateway /internal/timeline-event，
# 由其往「最新请求的会话」时间线追加 developer(kind=diary) 隐藏消息（前端不显示、模型可见）。
# 鉴权用 .env 的 INTERNAL_API_KEY（X-Internal-Key 头）。推送失败只记日志，绝不影响保存本身。
# ============================================================
GATEWAY_TIMELINE_EVENT_URL = 'http://127.0.0.1:3000/internal/timeline-event'
_ENV_FILE = os.path.join(PROJECT_ROOT, '.env')
_env_cache = None
def _env_get(key):
    global _env_cache
    if _env_cache is None:
        _env_cache = {}
        try:
            with open(_ENV_FILE, encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#') or '=' not in line: continue
                    k, v = line.split('=', 1)
                    _env_cache[k.strip()] = v.strip().strip('"').strip("'")
        except Exception as e:
            print('[timeline-event] 读 .env 失败:', e)
    return _env_cache.get(key)

def notify_timeline_event(event):
    def _post():
        try:
            key = _env_get('INTERNAL_API_KEY')
            if not key:
                print('[timeline-event] 缺 INTERNAL_API_KEY，跳过推送')
                return
            data = json.dumps(event, ensure_ascii=False).encode('utf-8')
            req = urllib.request.Request(GATEWAY_TIMELINE_EVENT_URL, data=data, method='POST',
                headers={'Content-Type': 'application/json', 'X-Internal-Key': key})
            resp = urllib.request.urlopen(req, timeout=5)
            print('[timeline-event]', event.get('type'), '->', resp.status)
        except Exception as e:
            print('[timeline-event] 推送失败（不影响保存）:', e)
    threading.Thread(target=_post, daemon=True).start()

# 唤醒订阅事件（2026-10-23，第 9 条第二步）：她发碎碎念 / 更新经期 / 记录心情时通知 gateway，
# 由它按「订阅了这一项的锁定会话」合并 5 分钟后叫醒 AI。同样只记日志、不影响保存本身。
GATEWAY_WAKE_EVENT_URL = 'http://127.0.0.1:3000/internal/wake-event'
def notify_wake_event(key):
    def _post():
        try:
            k = _env_get('INTERNAL_API_KEY')
            if not k: return
            data = json.dumps({'key': key}).encode('utf-8')
            req = urllib.request.Request(GATEWAY_WAKE_EVENT_URL, data=data, method='POST',
                headers={'Content-Type': 'application/json', 'X-Internal-Key': k})
            resp = urllib.request.urlopen(req, timeout=5)
            print('[wake-event]', key, '->', resp.status)
        except Exception as e:
            print('[wake-event] 通知失败（不影响保存）:', e)
    threading.Thread(target=_post, daemon=True).start()

def _atomic_save(path, data):
    """[位置:backend.py·_atomic_save] [JSON 存储统一原子写] [2026-10-27 审查 P1：原来 5 个存储都是 open(path,'w')
    先截断再写，写一半进程被打断（重启/OOM/磁盘）就留下半截 JSON，该文件的所有读接口从此 500 直到人工修复；
    notes/goban 目录缺失时写入必 500。统一改成：自动建目录 + 唯一 tmp 名（防两线程写同一个 tmp）+ os.replace 原子替换。
    注意：这只保证「文件要么是完整旧内容、要么是完整新内容」；读-改-写之间的并发丢更新仍需上层事务锁（未做，见审查报告）] [注释时间 2026-10-27]"""
    d = os.path.dirname(path)
    if d and not os.path.isdir(d): os.makedirs(d, exist_ok=True)
    tmp = '%s.tmp.%s.%s' % (path, os.getpid(), threading.get_ident())
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)

def _date_ok(date):
    """[位置:backend.py·_date_ok] [月历日期参数白名单] [2026-10-27 审查 P1：data.json 顶层有 periods/export 两个非日期键，
    date 传成它们会 500（records）甚至把经期数据覆盖掉（summary POST）；mood 路由早有校验，这里统一补齐] [注释时间 2026-10-27]"""
    return bool(re.match(r'^\d{4}-\d{2}-\d{2}$', date or ''))

def _amount(v):
    """[位置:backend.py·_amount] [账目金额统一转 float 并保留两位] [2026-10-27 审查 P1：字符串金额原样入库，
    月统计 += 抛 TypeError 被裸 except 吞掉、那一整天账目从统计里消失] [注释时间 2026-10-27]"""
    try: return round(float(v or 0), 2)
    except (TypeError, ValueError): return 0.0

# ============================================================
# 1. 用户的日记 Blueprint
# ============================================================
DIARY_DIR = os.path.join(PROJECT_ROOT, 'little-world/apps/han-diary')
DIARY_DATA = os.path.join(DIARY_DIR, 'diary.json')
DIARY_UPLOAD_DIR = os.path.join(DIARY_DIR, 'uploads')
DIARY_MAX_IMAGES = 9
DIARY_IMG_URL_RE = re.compile(r'^/diary/api/img/[A-Za-z0-9._-]+$')
DIARY_IMG_NAME_RE = re.compile(r'^[A-Za-z0-9._-]+$')
if not os.path.isdir(DIARY_UPLOAD_DIR): os.makedirs(DIARY_UPLOAD_DIR)
diary_bp = Blueprint('diary', __name__)

def diary_load():
    if not os.path.exists(DIARY_DATA): return {"entries": []}
    with open(DIARY_DATA, encoding='utf-8') as f: return json.load(f)
def diary_save(d): _atomic_save(DIARY_DATA, d)

@diary_bp.route('/diary/api/entries')
def diary_get_entries():
    d = diary_load()
    return jsonify(sorted(d["entries"], key=lambda x: x["ts"], reverse=True))

@diary_bp.route('/diary/api/upload', methods=['POST'])
def diary_upload_image():
    f = request.files.get('file')
    if not f or not f.filename: return jsonify({"error": "no file"}), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ('.jpg', '.jpeg', '.png', '.gif', '.webp'):
        return jsonify({"error": "bad type"}), 400
    data = f.read()
    if len(data) > 10 * 1024 * 1024:
        return jsonify({"error": "too large"}), 400
    name = 'img_' + datetime.datetime.now().strftime('%Y%m%d_%H%M%S') + '_' + uuid.uuid4().hex[:6] + ext
    with open(os.path.join(DIARY_UPLOAD_DIR, name), 'wb') as out:
        out.write(data)
    return jsonify({"ok": True, "url": '/diary/api/img/' + name})

@diary_bp.route('/diary/api/img/<name>')
def diary_get_image(name):
    if not DIARY_IMG_NAME_RE.match(name) or '..' in name:
        return jsonify({"error": "bad name"}), 400
    return send_from_directory(DIARY_UPLOAD_DIR, name)

@diary_bp.route('/diary/api/entries/add', methods=['POST'])
def diary_add_entry():
    body = request.json; text = (body.get("text") or "").strip()
    images = body.get("images") or []
    if not isinstance(images, list): images = []
    images = [u for u in images if isinstance(u, str) and DIARY_IMG_URL_RE.match(u)][:DIARY_MAX_IMAGES]
    # [位置:backend.py·diary_add_entry] [纯图片放行] [10-28：朋友圈允许纯图片——text 空但 images 非空不再拒；两者都空仍拒；URL 白名单和 9 张上限不变] [注释时间 2026-10-28]
    if not text and not images: return jsonify({"error":"empty"}),400
    d = diary_load()
    now = datetime.datetime.now().isoformat()
    # [位置:backend.py·diary_add_entry] [id 用 max+1 而不是条数+1] [2026-10-27 审查 P0：删中间一条后 len 减 1，
    # 新日记与旧日记撞号——线上已积了 3 组重复 id（47/51/64），编辑命中错条、删除一次删掉所有同 id 条] [注释时间 2026-10-27]
    entry = {"id": max([e.get("id", 0) for e in d["entries"]] or [0]) + 1, "text": text, "ts": now, "comments": []}
    if images: entry["images"] = images
    d["entries"].insert(0, entry)
    diary_save(d)
    # 2026-10-01：带 entry_id，供删日记时精确撤回这条通知（否则 AI 会读到已失效的「写了日记」情报）
    notify_timeline_event({"type": "han_diary", "time": now, "entry_id": entry["id"]})
    notify_wake_event('her_murmurs')
    return jsonify({"ok": True, "id": entry["id"]})

@diary_bp.route('/diary/api/entries/edit', methods=['POST'])
def diary_edit_entry():
    body = request.json; eid = body.get("id"); text = body.get("text","").strip()
    if not text: return jsonify({"error":"empty"}),400
    d = diary_load()
    for e in d["entries"]:
        if e["id"] == eid: e["text"] = text; e["edited"] = True; diary_save(d); return jsonify({"ok":True})
    return jsonify({"error":"not found"}),404

@diary_bp.route('/diary/api/entries/delete', methods=['POST'])
def diary_delete_entry():
    body = request.json; eid = body.get("id")
    d = diary_load()
    removed = [e for e in d["entries"] if e["id"] == eid]
    d["entries"] = [e for e in d["entries"] if e["id"] != eid]
    for e in removed:
        for u in e.get("images") or []:
            fname = os.path.basename(u)
            if DIARY_IMG_NAME_RE.match(fname):
                try: os.remove(os.path.join(DIARY_UPLOAD_DIR, fname))
                except OSError: pass
    diary_save(d)
    # 2026-10-01：删日记 → 同步撤回此前落时间线的「涵写了日记」通知。
    # 不撤回的话 AI 重建上下文看见「涵写了日记」却读不到正文，只能臆测（实测编出「初恋提示词」）。
    for e in removed:
        notify_timeline_event({"type": "diary_undo", "entry_id": e.get("id"), "time": e.get("ts")})
    return jsonify({"ok": True})

@diary_bp.route('/diary/api/entries/comment', methods=['POST'])
def diary_add_comment():
    body = request.json; eid = body.get("id"); text = body.get("text","").strip()
    author = body.get("author","xie")
    if not text: return jsonify({"error":"empty"}),400
    d = diary_load()
    for e in d["entries"]:
        if e["id"] == eid:
            e["comments"].append({"author": author, "text": text, "ts": datetime.datetime.now().isoformat()})
            diary_save(d)
            return jsonify({"ok": True})
    return jsonify({"error":"not found"}),404

# ============================================================
@diary_bp.route('/diary/api/entries/comment/delete', methods=['POST'])
def diary_delete_comment():
    body = request.json; eid = body.get("id"); ci = body.get("ci")
    d = diary_load()
    for e in d["entries"]:
        if e["id"] == eid:
            cmt = e["comments"]
            if isinstance(ci, int) and 0 <= ci < len(cmt):
                cmt.pop(ci)
                diary_save(d)
                return jsonify({"ok": True})
            return jsonify({"error": "bad index"}), 400
    return jsonify({"error": "not found"}), 404

# 2. 月历 Blueprint
# ============================================================
MONTHLY_DIR = os.path.join(PROJECT_ROOT, 'little-world/apps/monthly')
MONTHLY_DATA = os.path.join(MONTHLY_DIR, 'data.json')
monthly_bp = Blueprint('monthly', __name__)

def monthly_load():
    if not os.path.exists(MONTHLY_DATA): return {}
    with open(MONTHLY_DATA, encoding='utf-8') as f: return json.load(f)
def monthly_save(d): _atomic_save(MONTHLY_DATA, d)

def guess_category(goods, record_type):
    if record_type != '支出': return '其他'
    food = ['饭','餐','食堂','早餐','午餐','晚餐','美食','小吃','饮','咖啡','茶','菜','锅','烤','面','粉','粥','饺','包','奶','食']
    for w in food:
        if w in goods: return '餐饮'
    traffic = ['交通','打车','公交','地铁','高铁','自行车','出行','滴滴','加油','停车','路费','车票','客运','巴士','骑行']
    for w in traffic:
        if w in goods: return '交通'
    daily = ['超市','便利店','日用','洗','牙刷','毛巾','纸','垃圾袋','收纳','家居','水电','热水','电费','水费']
    for w in daily:
        if w in goods: return '日用'
    shop = ['服装','衣服','裙','穿搭','发饰','抓夹','鞋','包','帽','饰品','衣','裤','衫','袜','首饰','购物','买']
    for w in shop:
        if w in goods: return '购物'
    fun = ['娱乐','游戏','视频','音乐','会员','电影','演出']
    for w in fun:
        if w in goods: return '娱乐'
    medical = ['医疗','药','医院','诊所','健康','体检']
    for w in medical:
        if w in goods: return '医疗'
    learn = ['学习','课程','书','DeepSeek','API','教育','考试']
    for w in learn:
        if w in goods: return '其他'
    return '其他'

def _period_for_date(d, date):
    for p in d.get("periods") or []:
        if not p.get("start") or date < p["start"]:
            continue
        if not p.get("end") or date <= p["end"]:
            return p
    return None

def _iter_date_strs(start, end):
    cur = datetime.datetime.strptime(start, "%Y-%m-%d").date()
    stop = datetime.datetime.strptime(end, "%Y-%m-%d").date()
    out = []
    while cur <= stop:
        out.append(cur.isoformat())
        cur += datetime.timedelta(days=1)
    return out

@monthly_bp.route('/monthly/api/records/<date>')
def monthly_get_records(date):
    if not _date_ok(date): return jsonify({"error": "日期格式应为 YYYY-MM-DD"}), 400
    d = monthly_load()
    entry = dict(d.get(date, {"finance": [], "period": None}))
    entry["period"] = _period_for_date(d, date)
    return jsonify(entry)

@monthly_bp.route('/monthly/api/finance/monthly')
def monthly_finance():
    year = request.args.get('year', type=int)
    month = request.args.get('month', type=int)
    now = datetime.datetime.now()
    if not year: year = now.year
    if not month: month = now.month
    d = monthly_load()
    total_income = 0.0; total_expense = 0.0
    for date, content in d.items():
        try:
            dt = datetime.datetime.strptime(date, '%Y-%m-%d')
        except ValueError:
            continue   # periods/export 等非日期键
        if dt.year != year or dt.month != month: continue
        for record in content.get("finance", []):
            # [位置:backend.py·monthly_finance] [金额归一 float] [2026-10-27 审查 P1：amount 是字符串时 += 抛
            # TypeError，被裸 except 吞掉、那一整天账目从月统计里消失且无日志] [注释时间 2026-10-27]
            try: amount = float(record.get("amount") or 0)
            except (TypeError, ValueError):
                print('[monthly] 金额不是数字，该条不计入统计:', date, record.get('id')); continue
            if record.get("type") == "收入": total_income += amount
            else: total_expense += amount
    return jsonify({"year": year, "month": month, "income": round(total_income, 2), "expense": round(total_expense, 2), "balance": round(total_income - total_expense, 2)})

@monthly_bp.route('/monthly/api/finance/<date>', methods=['POST'])
def monthly_add_finance(date):
    if not _date_ok(date): return jsonify({"error": "日期格式应为 YYYY-MM-DD"}), 400
    body = request.json or {}
    d = monthly_load()
    if date not in d: d[date] = {"finance": [], "period": None}
    records = d[date].setdefault("finance", [])
    new_id = max([r.get("id", 0) for r in records] + [0]) + 1
    records.append({"id": new_id, "type": body.get("type", "支出"), "amount": _amount(body.get("amount", 0)), "category": body.get("category", ""), "note": body.get("note", ""), "by": body.get("by", "用户"), "ts": datetime.datetime.now().isoformat()})
    monthly_save(d)
    return jsonify({"ok": True, "id": new_id})

@monthly_bp.route('/monthly/api/finance/<date>/<int:fid>', methods=['PUT'])
def monthly_update_finance(date, fid):
    if not _date_ok(date): return jsonify({"error": "日期格式应为 YYYY-MM-DD"}), 400
    body = request.json or {}
    d = monthly_load()
    records = d.get(date, {}).get("finance", [])
    for r in records:
        if r["id"] == fid:
            if "amount" in body: r["amount"] = _amount(body["amount"])   # [位置:backend.py·monthly_update_finance] [金额归一] [2026-10-27 审查 P1] [注释时间 2026-10-27]
            for k in ["type","category","note"]:
                if k in body: r[k] = body[k]
            r["edited_at"] = datetime.datetime.now().isoformat()
            monthly_save(d)
            return jsonify({"ok": True})
    return jsonify({"error": "not found"}), 404

@monthly_bp.route('/monthly/api/finance/<date>/<int:fid>', methods=['DELETE'])
def monthly_delete_finance(date, fid):
    if not _date_ok(date): return jsonify({"error": "日期格式应为 YYYY-MM-DD"}), 400
    d = monthly_load()
    if date not in d: return jsonify({"ok": True})   # 日期节点已不存在（mood 删除等会把空节点整节点清掉），视为删成功；原来是 KeyError 500
    d[date]["finance"] = [r for r in d.get(date, {}).get("finance", []) if r["id"] != fid]
    monthly_save(d)
    return jsonify({"ok": True})

@monthly_bp.route('/monthly/api/finance/import', methods=['POST'])
def monthly_import_finance():
    if 'file' not in request.files:
        return jsonify({"error": "请上传文件"}), 400
    f = request.files['file']
    tp = request.form.get('type', 'alipay')
    confirm = request.form.get('confirm', 'false').lower() == 'true'
    if not f.filename: return jsonify({"error": "文件名为空"}), 400
    filename = f.filename.lower()
    records = []
    if filename.endswith('.xlsx'):
        records = monthly_parse_wechat_xlsx(f)
    else:
        raw = f.read()
        text = None
        for enc in ['gbk', 'gb18030', 'utf-8']:
            try: text = raw.decode(enc); break
            except: continue
        if not text: return jsonify({"error": "无法识别文件编码"}), 400
        lines = text.split('\n')
        start = 0
        for i, line in enumerate(lines):
            if '记录时间' in line or '交易时间' in line: start = i; break
        reader = csv.DictReader(io.StringIO('\n'.join(lines[start:])))
        for row in reader:
            r = monthly_parse_alipay(row) if tp == 'alipay' else monthly_parse_wechat(row)
            if r: records.append(r)
    if not records: return jsonify({"error": "未能解析到有效记录", "records": []}), 400
    # [位置:backend.py·monthly_import_finance 去重] [名称:指纹差集导入] [需求:11-16——同一账单文件导两次会重复入账（旧版无去重）；按「日期+收支+金额+内容」指纹与账本已有条目做出现次数差集：文件里 2 条相同、账本已有 1 条 → 只导 1 条，两次真实相同消费不受影响；dry-run 先在预览里告诉用户有几条会跳过] [注释时间 2026-11-16]
    from collections import Counter
    def _fp(date, tp_, amt, note):
        try: amt = round(float(amt), 2)
        except Exception: amt = 0.0
        return (date, tp_, amt, note or '')
    old = Counter()
    for od, ob in monthly_load().items():
        if not isinstance(ob, dict): continue
        for x in (ob.get('finance') or []):
            try: xamt = round(float(x.get('amount') or 0), 2)
            except Exception: xamt = 0.0
            old[(od, x.get('type'), xamt, x.get('note') or '')] += 1
    seen = Counter()
    to_import, skipped = [], 0
    for r in records:
        k = _fp(r['date'], r['type'], r['amount'], r['note'])
        seen[k] += 1
        if seen[k] <= old.get(k, 0): skipped += 1
        else: to_import.append(r)
    if not confirm: return jsonify({"total": len(records), "records": records[:200], "dup": skipped})
    d = monthly_load()
    written = 0
    for r in to_import:
        date = r['date']
        if date not in d: d[date] = {"finance": [], "period": None}
        recs = d[date].setdefault("finance", [])
        nid = max([x.get("id",0) for x in recs] + [0]) + 1
        recs.append({"id": nid, "type": r['type'], "amount": r['amount'], "category": r['category'], "note": r['note'], "by": "用户", "ts": datetime.datetime.now().isoformat(), "imported": True})
        written += 1
    monthly_save(d)
    return jsonify({"ok": True, "total": len(records), "written": written, "skipped": skipped})

def monthly_parse_alipay(row):
    try:
        ts = row.get('记录时间','').strip()
        if not ts: return None
        t = row.get('收支类型','').strip()
        amt = row.get('金额','').strip()
        if t == '支出': tp = '支出'
        elif t in ('收入','冲正收入','退款'): tp = '收入'
        else: return None
        goods = row.get('商品说明','').strip()
        return {"date": ts[:10], "type": tp, "amount": float(amt), "category": guess_category(goods, tp), "note": goods[:30] if len(goods)>30 else goods, "source": "alipay"}
    except: return None

def monthly_parse_wechat(row):
    try:
        ts = row.get('交易时间','').strip()
        if not ts: return None
        d = row.get('收/支','').strip()
        if '收入' in d or '入' in d: tp = '收入'
        elif '支出' in d or '支' in d or '付' in d: tp = '支出'
        else: return None
        amt = ''; goods = ''
        for k in ['金额(元)','金额（元）','金额']:
            if k in row and row[k].strip(): amt = row[k].strip(); break
        for k in ['商品','商品说明','交易对方']:
            if k in row and row[k].strip(): goods = row[k].strip(); break
        return {"date": ts[:10], "type": tp, "amount": float(amt) if amt else 0, "category": guess_category(goods, tp), "note": goods[:30] if len(goods)>30 else goods, "source": "wechat"}
    except: return None

def monthly_parse_wechat_xlsx(file_obj):
    import openpyxl
    from io import BytesIO
    file_obj.seek(0)
    data = file_obj.read()
    wb = openpyxl.load_workbook(BytesIO(data), read_only=True)
    records = []
    for ws in wb.worksheets:
        headers = None
        for row in ws.iter_rows(values_only=True):
            if not any(row): continue
            vals = [str(v).strip() if v is not None else '' for v in row]
            if headers is None:
                txt = '|'.join(vals)
                if '交易时间' in txt or '商品' in txt or '收/支' in txt: headers = vals
                continue
            if not any(vals): continue
            rd = {}
            for i, v in enumerate(vals):
                if i < len(headers): rd[headers[i]] = v
            for k in list(rd.keys()):
                if '收' in k and '支' in k and k != '收/支': rd['收/支'] = rd[k]; break
            r = monthly_parse_wechat(rd)
            if r: records.append(r)
        if headers: break
    wb.close()
    return records

@monthly_bp.route('/monthly/api/period/toggle', methods=['POST'])
def monthly_toggle_period():
    """经期开关（2026-09-19 批6 D3 重做）：开=从今天开始（已有进行中则不重复建）；
    关=结束于今天（当天开当天关保留为单日记录，不再丢弃）。开始/结束日的精确修正走 /period/update。"""
    body = request.json or {}
    on = body.get("on") in (True, "true", 1, "1")
    date = str(body.get("date", "") or "").strip()
    if not date:
        return jsonify({"error": "缺少日期"}), 400
    d = monthly_load()
    periods = d.get("periods") or []
    active = [p for p in periods if not p.get("end")]
    event = None
    if on:
        if not active:
            p = {"start": date, "end": None, "flow": "", "note": "", "by": "用户", "updated_at": datetime.datetime.now().isoformat()}
            periods.append(p)
            event = {"type": "period_start", "start": date, "time": p["updated_at"]}
    else:
        if active:
            p = active[-1]
            p["end"] = date if date >= p.get("start", date) else p["start"]
            p["updated_at"] = datetime.datetime.now().isoformat()
            event = {"type": "period_end", "start": p["start"], "end": p["end"], "time": p["updated_at"]}
    d["periods"] = periods
    monthly_save(d)
    if event:
        notify_timeline_event(event)
        notify_wake_event('period')
    return jsonify({"ok": True})

@monthly_bp.route('/monthly/api/period/update', methods=['POST'])
def monthly_update_period():
    """手动修正某次经期的开始/结束日（end 传空 = 进行中）。按原开始日定位记录。"""
    body = request.json or {}
    start_old = str(body.get("start_old", "") or "").strip()
    start = str(body.get("start", "") or "").strip()
    end = str(body.get("end", "") or "").strip() or None
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', start_old):
        return jsonify({"error": "start_old 日期格式应为 YYYY-MM-DD"}), 400
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', start):
        return jsonify({"error": "start 日期格式应为 YYYY-MM-DD"}), 400
    if end and not re.match(r'^\d{4}-\d{2}-\d{2}$', end):
        return jsonify({"error": "end 日期格式应为 YYYY-MM-DD"}), 400
    if end and end < start:
        return jsonify({"error": "结束日不能早于开始日"}), 400
    d = monthly_load()
    periods = d.get("periods") or []
    target = None
    for p in periods:
        if p.get("start") == start_old:
            target = p
    if target is None:
        return jsonify({"error": "未找到开始日为 " + start_old + " 的经期记录"}), 404
    if any(p is not target and p.get("start") == start for p in periods):
        return jsonify({"error": "已存在相同开始日的记录"}), 400
    target["start"] = start
    target["end"] = end
    target["updated_at"] = datetime.datetime.now().isoformat()
    d["periods"] = periods
    monthly_save(d)
    notify_wake_event('period')
    return jsonify({"ok": True})

@monthly_bp.route('/monthly/api/period/<date>', methods=['DELETE'])
def monthly_delete_period(date):
    if not _date_ok(date): return jsonify({"error": "日期格式应为 YYYY-MM-DD"}), 400
    d = monthly_load()
    # [位置:backend.py·monthly_delete_period] [进行中的经期 end 是 None] [2026-10-27 审查 P0：原来
    # p.get("start") <= date <= None 直接 TypeError 500，而「进行中」恰是最常见状态（线上当前就有一条）] [注释时间 2026-10-27]
    def _hit(p):
        ps, pe = p.get("start"), p.get("end")
        return bool(ps) and ps <= date and (pe is None or date <= pe)
    d["periods"] = [p for p in (d.get("periods") or []) if not _hit(p)]
    monthly_save(d)
    return jsonify({"ok": True})

@monthly_bp.route('/monthly/api/periods')
def monthly_get_periods():
    d = monthly_load()
    return jsonify(d.get("periods") or [])

@monthly_bp.route('/monthly/api/markers')
def monthly_get_markers():
    d = monthly_load()
    finance_dates = set(); period_dates = set(); summary_dates = set()
    for date, content in d.items():
        if date == "2026-07-05": continue
        if not isinstance(content, dict): continue
        if content.get("finance") and len(content["finance"]) > 0: finance_dates.add(date)
        if content.get("summary") and content["summary"].get("text"): summary_dates.add(date)
    today_iso = datetime.datetime.now().strftime("%Y-%m-%d")
    # 2026-09-19 批6 D3：月历只显示最近一次经期（历史记录不再全部撒点）
    plist = [p for p in (d.get("periods") or []) if p.get("start")]
    if plist:
        latest = max(plist, key=lambda p: p["start"])
        end = latest.get("end") or today_iso
        if end < latest["start"]:
            end = latest["start"]
        for dt in _iter_date_strs(latest["start"], end):
            period_dates.add(dt)
    mood_map = {}
    for date, content in d.items():
        if isinstance(content, dict) and isinstance(content.get("mood"), dict):
            m = {}
            for side in ("her", "ai"):
                v = content["mood"].get(side)
                if v and (v.get("ids") or v.get("custom")): m[side] = {"ids": v.get("ids") or [], "custom": v.get("custom") or ""}
            if m: mood_map[date] = m
    return jsonify({"finance": sorted(list(finance_dates)), "period": sorted(list(period_dates)), "summary": sorted(list(summary_dates)), "mood": mood_map})

@monthly_bp.route('/monthly/api/summary/<date>', methods=['GET', 'POST'])
def monthly_handle_summary(date):
    if not _date_ok(date): return jsonify({"error": "日期格式应为 YYYY-MM-DD"}), 400
    if request.method == 'GET':
        d = monthly_load()
        entry = d.get(date, {}); s = entry.get("summary", {})
        return jsonify({"text": s.get("text", ""), "by": s.get("by", ""), "updated_at": s.get("updated_at", "")})
    else:
        body = request.json; text = body.get("text", "").strip()
        if not text: return jsonify({"error": "内容不能为空"}), 400
        d = monthly_load()
        if date not in d: d[date] = {"finance": [], "period": None}
        d[date]["summary"] = {"text": text, "by": body.get("by", "用户"), "updated_at": datetime.datetime.now().isoformat()}
        monthly_save(d)
        return jsonify({"ok": True})

# [位置:backend.py·心情] [月历每天的「总结心情」，她和他各一份] [10-23：每天选 1~3 个，不是某一刻的心情；表里 20 个，另可自定义一段文字/emoji（custom）；存在 data.json 的 日期.mood.{her,ai} = {ids,custom,updated_at}；她那侧小手机点选，他那侧只有 mood 工具能写；图标文件在 workspace/mood/<id>.svg，前端按 id 取] [注释时间 2026-10-23]
MOOD_TABLE = [
    {"id": "full_power", "name": "满电", "desc": "今天有精神~"},
    {"id": "melted", "name": "融化了", "desc": "累……"},
    {"id": "hungry", "name": "干饭魂", "desc": "饿了，想吃点好的"},
    {"id": "lying_flat", "name": "躺平", "desc": "懒癌发作。不想动。"},
    {"id": "down", "name": "有点down", "desc": "emo，想抱抱"},
    {"id": "zoning_out", "name": "放空", "desc": "脑子空空，飘着"},
    {"id": "puffed_up", "name": "气鼓鼓", "desc": "谁惹我了，气"},
    {"id": "loved", "name": "被爱充能", "desc": "今天被哄爽了"},
    {"id": "craving", "name": "馋", "desc": "嘴馋，任何意义上的馋"},
    {"id": "bunny", "name": "兔子", "desc": "被哄着缩在怀里的软乎状态"},
    {"id": "leopard_cat", "name": "豹猫附体", "desc": "炸毛但可爱，雾主兽化皮肤同款，有妙脆角毛茸茸耳朵和尾巴。谢专属"},
    {"id": "little_flame", "name": "小火苗", "desc": "干劲上头、精神着了火。谢专属。"},
    {"id": "thinking", "name": "在想事", "desc": "脑子里在转，想事情"},
    {"id": "anxious", "name": "焦虑", "desc": "心里发紧，静不下来"},
    {"id": "sick", "name": "不舒服", "desc": "身体不太舒服"},
    {"id": "silly", "name": "调皮", "desc": "想闹、想逗人"},
    {"id": "cozy", "name": "惬意", "desc": "松弛舒服，什么都刚好"},
    {"id": "busy", "name": "在忙", "desc": "手上一堆事，忙着"},
    {"id": "happy", "name": "开心", "desc": "就是开心"},
    {"id": "shy", "name": "害羞", "desc": "脸红红的"},
]
MOOD_IDS = set(m["id"] for m in MOOD_TABLE)
MOOD_SIDES = ("her", "ai")

def _mood_clean(v):
    return {"ids": v.get("ids") or [], "custom": v.get("custom") or "", "updated_at": v.get("updated_at") or ""}

@monthly_bp.route('/monthly/api/mood/table')
def monthly_mood_table():
    return jsonify(MOOD_TABLE)

@monthly_bp.route('/monthly/api/mood/<date>', methods=['GET'])
def monthly_mood_get(date):
    if not _date_ok(date): return jsonify({"error": "日期格式应为 YYYY-MM-DD"}), 400
    d = monthly_load()
    m = (d.get(date) or {}).get("mood") or {}
    return jsonify({"date": date, "her": _mood_clean(m.get("her") or {}), "ai": _mood_clean(m.get("ai") or {})})

@monthly_bp.route('/monthly/api/mood/<date>', methods=['POST'])
def monthly_mood_set(date):
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date): return jsonify({"error": "日期格式应为 YYYY-MM-DD"}), 400
    body = request.json or {}
    side = body.get("side")
    if side not in MOOD_SIDES: return jsonify({"error": "side 只能是 her 或 ai"}), 400
    ids = body.get("ids") or []
    if not isinstance(ids, list): return jsonify({"error": "ids 必须是数组"}), 400
    ids = [str(i) for i in ids]
    seen = []
    for i in ids:
        if i not in MOOD_IDS: return jsonify({"error": "未知心情 id：" + i}), 400
        if i not in seen: seen.append(i)
    custom = str(body.get("custom") or "").strip()[:20]
    if len(seen) + (1 if custom else 0) < 1: return jsonify({"error": "至少选 1 个（id 或 custom 文字）"}), 400
    if len(seen) + (1 if custom else 0) > 3: return jsonify({"error": "最多 3 个（自定义也算 1 个）"}), 400
    d = monthly_load()
    if date not in d: d[date] = {"finance": [], "period": None}
    prev = _mood_clean((d[date].get("mood") or {}).get(side) or {})
    d[date].setdefault("mood", {})[side] = {"ids": seen, "custom": custom, "updated_at": datetime.datetime.now().isoformat()}
    monthly_save(d)
    if side == "her": notify_wake_event('mood')   # 只有她自己记心情才叫醒他；他自己写的不算
    return jsonify({"ok": True, "date": date, "side": side, "ids": seen, "custom": custom, "previous": prev})

@monthly_bp.route('/monthly/api/mood/<date>', methods=['DELETE'])
def monthly_mood_delete(date):
    if not _date_ok(date): return jsonify({"error": "日期格式应为 YYYY-MM-DD"}), 400
    side = request.args.get("side")
    if side not in MOOD_SIDES: return jsonify({"error": "side 只能是 her 或 ai"}), 400
    d = monthly_load()
    e = d.get(date)
    if isinstance(e, dict) and isinstance(e.get("mood"), dict) and side in e["mood"]:
        del e["mood"][side]
        if not e["mood"]: del e["mood"]
        if not e.get("finance") and not e.get("period") and not e.get("summary") and not e.get("mood"): d.pop(date, None)
        monthly_save(d)
    return jsonify({"ok": True})

# ============================================================
# 5. 待办/心动/记忆桶 Blueprint
# ============================================================
TODO_DIR = os.path.join(PROJECT_ROOT, 'little-world/apps/todo-heart')
TODO_DATA = os.path.join(TODO_DIR, 'data.json')
todo_bp = Blueprint('todo', __name__)

_todo_cache = {"mtime": None, "data": None}

def todo_load():
    """[位置:backend.py·todo_load] [mtime 缓存] [2026-10-27 审查 P2：data.json 已 484KB，
    /todo/api/reminders/claim 由网关每 15s 轮询一次，每次全量 json.load 纯属重复劳动。
    现按 mtime 缓存：写路径全部走 _atomic_save（os.replace 会更新 mtime），缓存自动失效；
    快速路径 stat 一次，慢路径里用 os.fstat(已打开的 fd) 取 mtime——mtime 与读到的内容
    来自同一个文件版本，杜绝「stat 到新 mtime、读到旧内容」把脏数据永久钉在缓存里的竞态] [注释时间 2026-10-27]"""
    try:
        mtime = os.stat(TODO_DATA).st_mtime_ns
    except OSError:
        return {"todos": {}, "moments": []}
    if _todo_cache["mtime"] == mtime and _todo_cache["data"] is not None:
        return _todo_cache["data"]
    try:
        with open(TODO_DATA, encoding='utf-8') as f:
            d = json.load(f)
            _todo_cache["mtime"] = os.fstat(f.fileno()).st_mtime_ns
    except FileNotFoundError:
        return {"todos": {}, "moments": []}
    _todo_cache["data"] = d
    return d

def _norm_moment_text(s):
    """归一化文本用于去重：去空白、去掉结尾的 --- 分隔符"""
    s = (s or "").strip()
    s = re.sub(r"\s*-{3,}\s*$", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _split_dialog_text(text):
    """把 '用户：…\n助手：…' 合并文本尽力拆回双方字段，拆不出则原样保留"""
    if not text:
        return "", ""
    han, xie = [], []
    cur = None
    for line in text.splitlines():
        stripped = line.strip()
        m = re.match(r"^(用户|助手|涵|谢)：", stripped)
        if m:
            cur = "han" if m.group(1) in ("用户", "涵") else "xie"
            content = stripped[m.end():].strip()
            (han if cur == "han" else xie).append(content)
        elif cur and stripped:
            (han if cur == "han" else xie).append(stripped)
    return "\n".join(han), "\n".join(xie)
def todo_save(d): _atomic_save(TODO_DATA, d)

@todo_bp.route('/todo/api/todos')
def todo_get_todos():
    d = todo_load()
    todos = d.get("todos", {})
    result = []; seen = set()
    for date in sorted(todos.keys(), reverse=True):
        for t in todos[date]:
            if not t.get('done', False) and t['id'] not in seen:
                seen.add(t['id']); result.append(t)
    result.sort(key=lambda x: x['id'])
    # 2026-10-23 需求 53 长按排序：data.json 里的 order 是用户拖出来的顺序（id 数组），这里给每条带上 pos（在 order 里的位置）；
    # 没排过的新待办没有 pos，前端把它们排在最前。老调用方（小组件、AI 工具）看到的列表顺序不变。
    pos = {}
    for i, tid in enumerate(d.get("order") or []):
        if isinstance(tid, int) and tid not in pos: pos[tid] = i
    return jsonify([dict(t, pos=pos[t['id']]) if t['id'] in pos else t for t in result])

@todo_bp.route('/todo/api/todos/reorder', methods=['POST'])
def todo_reorder():
    """待办长按排序（2026-10-23 需求 53）：前端把当前所有未完成待办按显示顺序的 id 整张交上来，存进 data.json 的 order。"""
    body = request.json or {}
    ids = body.get("ids")
    if not isinstance(ids, list) or not all(isinstance(i, int) and not isinstance(i, bool) for i in ids):
        return jsonify({"error": "ids 必须是整数数组"}), 400
    seen = []
    for i in ids:
        if i not in seen: seen.append(i)
    d = todo_load()
    d["order"] = seen
    todo_save(d)
    return jsonify({"ok": True, "count": len(seen)})

@todo_bp.route('/todo/api/todos/delete', methods=['POST'])
def todo_delete_todo():
    body = request.json; tid = body.get("id")
    d = todo_load()
    todos = d.get("todos", {})
    for date in list(todos.keys()):
        todos[date] = [t for t in todos[date] if t['id'] != tid]
        if not todos[date]: del todos[date]
    d['todos'] = todos
    todo_save(d)
    return jsonify({"ok": True})

@todo_bp.route('/todo/api/todos/add', methods=['POST'])
def todo_add_todo_han():
    body = request.json
    text = body.get("text", "").strip()
    text_han = body.get("text_han", "").strip()
    text_xie = body.get("text_xie", "").strip()
    if not text and (text_han or text_xie):
        parts = []
        if text_han: parts.append("用户：" + text_han)
        if text_xie: parts.append("我：" + text_xie)
        text = "\n".join(parts)
    if not text: return jsonify({"error": "empty"}), 400
    d = todo_load()
    today = datetime.date.today().isoformat()
    if today not in d["todos"]: d["todos"][today] = []
    tid = max((t['id'] for day in d['todos'].values() for t in day), default=0) + 1
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    d["todos"][today].append({"id": tid, "text": f"{text} {now}", "done": False, "by": "han"})
    todo_save(d)
    return jsonify({"ok": True})

@todo_bp.route('/todo/api/todos/xie', methods=['POST'])
def todo_xie_todo():
    body = request.get_json(silent=True) or {}
    text = str(body.get("text") or "").strip()
    text_han = str(body.get("text_han") or "").strip()
    text_xie = str(body.get("text_xie") or "").strip()
    if not text and (text_han or text_xie):
        parts = []
        if text_han: parts.append("用户：" + text_han)
        if text_xie: parts.append("我：" + text_xie)
        text = "\n".join(parts)
    if not text: return jsonify({"error": "empty"}), 400

    # 可选提醒时间：按项目 TIME_ZONE 解析墙上时间；只接受明确的 YYYY-MM-DD HH:mm。
    remind_at = str(body.get("remind_at") or "").strip()
    remind_epoch_ms = None
    if remind_at:
        try:
            from zoneinfo import ZoneInfo
        except ImportError:
            from backports.zoneinfo import ZoneInfo
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}", remind_at):
            return jsonify({"error": "remind_at 格式应为 YYYY-MM-DD HH:mm（项目时区）"}), 400
        try:
            tz_name = _env_get('TIME_ZONE') or 'Asia/Shanghai'
            tz = ZoneInfo(tz_name)
            wall = datetime.datetime.strptime(remind_at, "%Y-%m-%d %H:%M").replace(tzinfo=tz)
            # 回读校验，拒绝无效日期及夏令时不存在的墙上时间。
            if wall.strftime("%Y-%m-%d %H:%M") != remind_at:
                raise ValueError("invalid date")
            remind_epoch_ms = int(wall.timestamp() * 1000)
            if remind_epoch_ms <= int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000):
                return jsonify({"error": "remind_at 必须是未来时间"}), 400
        except Exception as exc:
            return jsonify({"error": "remind_at 无效，请确认日期、时间及项目时区", "detail": str(exc)}), 400

    d = todo_load()
    today = datetime.date.today().isoformat()
    if today not in d["todos"]: d["todos"][today] = []
    tid = max((t['id'] for day in d['todos'].values() for t in day), default=0) + 1
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    item = {"id": tid, "text": f"\U0001f4cc {text} {now}", "done": False, "by": "xie"}
    if remind_at:
        item["remind_at"] = remind_at
        item["remind_at_ms"] = remind_epoch_ms
        item["reminder_status"] = "pending"
    d["todos"][today].append(item)
    todo_save(d)
    return jsonify({"ok": True, "id": tid, "remind_at": remind_at or None})

def _todo_reminder_authorized():
    expected = _env_get('INTERNAL_API_KEY')
    supplied = request.headers.get('X-Internal-Key', '')
    return bool(expected and supplied and supplied == expected)

@todo_bp.route('/todo/api/reminders/claim', methods=['POST'])
def todo_claim_due_reminders():
    # 由 gateway 带内部密钥轮询，防止公网调用者提前领取/改写提醒状态。
    if not _todo_reminder_authorized(): return jsonify({"error": "unauthorized"}), 401
    body = request.get_json(silent=True) or {}
    now_ms = int(body.get("now_ms") or datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
    lease_ms = 2 * 60 * 1000
    d = todo_load()
    claimed = []
    for day in sorted((d.get("todos") or {}).keys()):
        for item in d["todos"].get(day, []):
            if item.get("done") or not item.get("remind_at_ms"):
                continue
            status = item.get("reminder_status", "pending")
            if status == "sent":
                continue
            if status == "sending" and now_ms - int(item.get("reminder_claimed_at_ms") or 0) < lease_ms:
                continue
            if int(item.get("remind_at_ms") or 0) > now_ms:
                continue
            item["reminder_status"] = "sending"
            item["reminder_claimed_at_ms"] = now_ms
            claimed.append({"id": item.get("id"), "text": item.get("text", ""), "remind_at": item.get("remind_at")})
    if claimed:
        todo_save(d)
    return jsonify({"reminders": claimed})

@todo_bp.route('/todo/api/reminders/result', methods=['POST'])
def todo_finish_reminder():
    if not _todo_reminder_authorized(): return jsonify({"error": "unauthorized"}), 401
    body = request.get_json(silent=True) or {}
    tid = body.get("id")
    ok = body.get("ok") is True
    d = todo_load()
    found = None
    for day in (d.get("todos") or {}).values():
        for item in day:
            if item.get("id") == tid and item.get("remind_at_ms"):
                found = item
                break
        if found: break
    if not found:
        return jsonify({"ok": True, "missing": True})
    found["reminder_status"] = "sent" if ok else "pending"
    found.pop("reminder_claimed_at_ms", None)
    if ok:
        # [位置:backend.py·todo_finish_reminder] [时间口径统一为本地] [2026-10-27 审查 P2：全文件存的都是
        # 本地 naive isoformat，只有这里写 UTC aware，AI 读待办时会看到差 8 小时的发送时间；无解析方，直接统一] [注释时间 2026-10-27]
        found["reminder_sent_at"] = datetime.datetime.now().isoformat()
    else:
        found["reminder_last_error"] = str(body.get("error") or "push failed")[:300]
    todo_save(d)
    return jsonify({"ok": True, "status": found["reminder_status"]})

@todo_bp.route('/todo/api/moments')
def todo_get_moments():
    d = todo_load()
    # [位置:backend.py·todo_get_moments] [默认字段补全改在副本上做] [2026-10-27 审查 P2：todo_load 加了 mtime
    # 缓存后，这里原地改缓存对象又不落盘，补出来的默认字段会被下一次写路由顺手 save 进 data.json；
    # 改成 dict 浅拷贝补全，只影响本次响应，不污染缓存] [注释时间 2026-10-27]
    moments = []
    for m in d["moments"]:
        c = dict(m)
        if "title" not in c: c["title"] = ""
        if "feelings" not in c: c["feelings"] = ""
        if "category" not in c: c["category"] = ""
        if "timeline_order" not in c: c["timeline_order"] = c["id"]
        if "is_defining" not in c: c["is_defining"] = False
        if "defining_note" not in c: c["defining_note"] = ""
        if "stage" not in c: c["stage"] = ""
        if "text_han" not in c: c["text_han"] = ""
        if "text_xie" not in c: c["text_xie"] = ""
        if "thinking" not in c: c["thinking"] = ""
        moments.append(c)
    moments = sorted(moments, key=lambda x: x["ts"], reverse=True)
    limit = request.args.get("limit", type=int, default=200)
    if limit and limit > 0:
        moments = moments[:limit]
    return jsonify(moments)

@todo_bp.route('/todo/api/moments/add', methods=['POST'])
def todo_add_moment():
    body = request.json
    text = body.get("text", "").strip()
    text_han = body.get("text_han", "").strip()
    text_xie = body.get("text_xie", "").strip()
    if not text and (text_han or text_xie):
        parts = []
        if text_han: parts.append("用户：" + text_han)
        if text_xie: parts.append("我：" + text_xie)
        text = "\n".join(parts)
    if not text: return jsonify({"error": "empty"}), 400
    d = todo_load()
    max_id = max((m["id"] for m in d["moments"]), default=0)
    ts = datetime.datetime.now().isoformat()
    d["moments"].append({"text": text, "text_han": body.get("text_han","").strip(), "text_xie": body.get("text_xie","").strip(), "thinking": body.get("thinking","").strip(), "title": body.get("title","").strip(), "feelings": body.get("feelings","").strip(), "category": body.get("category",""), "timeline_order": body.get("timeline_order", max_id+1), "is_defining": body.get("is_defining", False), "defining_note": body.get("defining_note","").strip(), "stage": body.get("stage",""), "ts": ts, "id": max_id+1})
    todo_save(d)
    return jsonify({"ok": True})

@todo_bp.route('/todo/api/moments/edit', methods=['POST'])
def todo_edit_moment():
    body = request.json; mid = body.get("id")
    text = body.get("text", "").strip()
    text_han = body.get("text_han", "").strip()
    text_xie = body.get("text_xie", "").strip()
    if not text and (text_han or text_xie):
        parts = []
        if text_han: parts.append("用户：" + text_han)
        if text_xie: parts.append("我：" + text_xie)
        text = "\n".join(parts)
    if not mid or not text: return jsonify({"error": "missing id or text"}), 400
    d = todo_load()
    for m in d["moments"]:
        if m["id"] == mid:
            m["text"] = text
            for k in ["title","text_han","text_xie","thinking","feelings","category","defining_note","stage"]:
                if k in body: m[k] = body.get(k, "").strip()
            if "timeline_order" in body:
                try: m["timeline_order"] = int(body["timeline_order"])
                except: pass
            if "is_defining" in body: m["is_defining"] = bool(body["is_defining"])
            m["ts"] = datetime.datetime.now().isoformat()
            todo_save(d)
            return jsonify({"ok": True})
    return jsonify({"error": "not found"}), 404

@todo_bp.route('/todo/api/moments/delete', methods=['POST'])
def todo_delete_moment():
    body = request.json; mid = body.get("id")
    if mid is None: return jsonify({"error": "missing id"}), 400
    d = todo_load()
    d["moments"] = [m for m in d["moments"] if m["id"] != mid]
    todo_save(d)
    return jsonify({"ok": True})

@todo_bp.route('/todo/api/moments/import', methods=['POST'])
def todo_import_moments():
    body = request.json
    items = None
    if isinstance(body, list):
        items = body
    elif isinstance(body, dict):
        items = body.get("items") or body.get("moments")
    if not items or not isinstance(items, list):
        return jsonify({"error": "invalid items"}), 400
    d = todo_load()
    max_id = max((m["id"] for m in d["moments"]), default=0)
    ts_now = datetime.datetime.now().isoformat()
    imported = 0
    imported_items = []
    existing = set(_norm_moment_text(m.get("text")) for m in d["moments"])
    for item in items:
        text_han = (item.get("text_han") or "").strip()
        text_xie = (item.get("text_xie") or "").strip()
        raw_text = (item.get("text") or "").strip()
        thinking = (item.get("thinking") or "").strip()
        if not text_han and not text_xie and not raw_text:
            continue
        parts = []
        if text_han: parts.append("用户：" + text_han)
        if text_xie: parts.append("我：" + text_xie)
        text = raw_text or "\n".join(parts)
        if not text_han and not text_xie:
            text_han, text_xie = _split_dialog_text(text)
        norm_key = _norm_moment_text(text)
        if norm_key in existing:
            continue
        existing.add(norm_key)
        max_id += 1
        ts = item.get("ts") or ts_now
        d["moments"].append({
            "text": text,
            "text_han": text_han,
            "text_xie": text_xie,
            "thinking": thinking,
            "title": (item.get("title") or "").strip(),
            "feelings": (item.get("feelings") or "").strip(),
            "category": (item.get("category") or ""),
            "timeline_order": max_id,
            "is_defining": bool(item.get("is_defining", False)),
            "defining_note": (item.get("defining_note") or "").strip(),
            "stage": (item.get("stage") or ""),
            "ts": ts,
            "id": max_id
        })
        imported_items.append(d["moments"][-1])
        imported += 1
    todo_save(d)
    return jsonify({"ok": True, "imported": imported})

@todo_bp.route('/todo/api/moments/reorder', methods=['POST'])
def todo_reorder_moments():
    body = request.json; order = body.get("order")
    if not order or not isinstance(order, list): return jsonify({"error": "invalid order"}), 400
    d = todo_load()
    id_map = {m["id"]: m for m in d["moments"]}
    for i, mid in enumerate(order):
        if mid in id_map: id_map[mid]["timeline_order"] = i
    todo_save(d)
    return jsonify({"ok": True})

@todo_bp.route('/todo/api/moments/batch-update', methods=['POST'])
def todo_batch_update():
    body = request.json; updates = body.get("updates", [])
    if not updates: return jsonify({"error": "no updates"}), 400
    d = todo_load()
    id_map = {m["id"]: m for m in d["moments"]}
    touched = []
    for u in updates:
        mid = u.get("id")
        if mid not in id_map: continue
        m = id_map[mid]
        for k in ["title","text","text_han","text_xie","thinking","feelings","category","defining_note","stage"]:
            if k in u: m[k] = u[k]
        if "timeline_order" in u:
            try: m["timeline_order"] = int(u["timeline_order"])
            except: pass
        if "is_defining" in u: m["is_defining"] = bool(u["is_defining"])
        touched.append(m)
    todo_save(d)
    return jsonify({"ok": True})

@todo_bp.route('/todo/api/moments/search')
def todo_search_moments():
    q = request.args.get('q', '').strip().lower()
    if not q: return jsonify([])
    d = todo_load()
    results = []
    seen = set()
    for m in d["moments"]:
        text = m.get("text","").lower(); title = m.get("title","").lower(); feelings = m.get("feelings","").lower(); note = m.get("defining_note","").lower()
        if q in text or q in title or q in feelings or q in note:
            key = _norm_moment_text(m.get("text"))
            if key in seen: continue
            seen.add(key)
            for k in ["title","text_han","text_xie","thinking","feelings","category","defining_note","stage"]:
                if k not in m: m[k] = ""
            if "timeline_order" not in m: m["timeline_order"] = m["id"]
            if "is_defining" not in m: m["is_defining"] = False
            results.append(m)
    return jsonify(sorted(results, key=lambda x: x["ts"], reverse=True)[:50])


# ── 心动时刻语义搜索：TF-IDF + 字符 bigram + 余弦相似度 ──
_tfidf_cache = {"version": None, "vocab": None, "tfidf_matrix": None, "ids": None}

def _char_bigrams(text):
    """中文用字符 bigram 切分，适合短文本模糊匹配"""
    text = text.lower()
    text = re.sub(r'[^\w\u4e00-\u9fa5]', ' ', text)
    chars = [c for c in text if not c.isspace()]
    if len(chars) < 2:
        return chars
    return [''.join(chars[i:i+2]) for i in range(len(chars)-1)]

def _build_moment_search_text(m):
    """把心动时刻的所有文本字段合并成检索文本"""
    parts = []
    for key in ['title', 'text', 'feelings', 'defining_note', 'category', 'stage', 'thinking']:
        v = m.get(key, '')
        if v:
            parts.append(str(v))
    return ' '.join(parts)

def _build_tfidf_cache(moments):
    """构建 TF-IDF 矩阵并缓存，数据变化时自动重建"""
    global _tfidf_cache
    ids = [m.get('id', i) for i, m in enumerate(moments)]
    # [位置:backend.py·_build_tfidf_cache] [版本键带文本指纹] [2026-10-27 审查 P1：原来版本只由条数+前10个id构成，
    # /moments/edit 改了正文但 id 与条数不变，矩阵永不重建，编辑后语义搜索一直搜旧文本] [注释时间 2026-10-27]
    _h = hashlib.md5()
    for m in moments:
        _h.update((str(m.get('id', '')) + '|' + (m.get('text') or '')[:64] + '\n').encode('utf-8', 'ignore'))
    version = f"{len(ids)}_{_h.hexdigest()[:12]}"
    if _tfidf_cache["version"] == version and _tfidf_cache["tfidf_matrix"] is not None:
        return
    docs = []
    for m in moments:
        text = _build_moment_search_text(m)
        docs.append(_char_bigrams(text))
    vocab = {}
    doc_freq = []
    for tokens in docs:
        unique = set(tokens)
        for t in unique:
            if t not in vocab:
                vocab[t] = len(vocab)
                doc_freq.append(0)
            doc_freq[vocab[t]] += 1
    n_docs = len(docs)
    vocab_size = len(vocab)
    tfidf_matrix = np.zeros((n_docs, vocab_size), dtype=np.float32)
    for i, tokens in enumerate(docs):
        if not tokens:
            continue
        tf = {}
        for t in tokens:
            tf[t] = tf.get(t, 0) + 1
        total = len(tokens)
        for t, count in tf.items():
            j = vocab[t]
            tf_val = count / total
            idf_val = math.log((n_docs + 1) / (doc_freq[j] + 1)) + 1
            tfidf_matrix[i, j] = tf_val * idf_val
        norm = np.linalg.norm(tfidf_matrix[i])
        if norm > 0:
            tfidf_matrix[i] /= norm
    _tfidf_cache = {
        "version": version,
        "vocab": vocab,
        "tfidf_matrix": tfidf_matrix,
        "ids": ids
    }

@todo_bp.route('/todo/api/moments/semantic-search')
def todo_semantic_search_moments():
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify([])
    try:
        limit = int(request.args.get('limit', 20))
    except:
        limit = 20
    threshold_str = request.args.get('threshold', '')
    try:
        threshold = float(threshold_str) if threshold_str else 0.08
    except:
        threshold = 0.08
    d = todo_load()
    moments = d.get('moments', [])
    if not moments:
        return jsonify([])
    _build_tfidf_cache(moments)
    _c = _tfidf_cache   # [位置:backend.py·todo_semantic_search_moments] [一次取整个缓存对象] [2026-10-27 审查：分两次下标可能跨两次重建取 vocab 与 matrix，维度不匹配 ValueError] [注释时间 2026-10-27]
    vocab = _c["vocab"]
    tfidf_matrix = _c["tfidf_matrix"]
    q_tokens = _char_bigrams(q)
    if not q_tokens:
        return jsonify([])
    q_vec = np.zeros(len(vocab), dtype=np.float32)
    q_tf = {}
    for t in q_tokens:
        q_tf[t] = q_tf.get(t, 0) + 1
    total = len(q_tokens)
    for t, count in q_tf.items():
        if t in vocab:
            j = vocab[t]
            q_vec[j] = count / total
    q_norm = np.linalg.norm(q_vec)
    if q_norm == 0:
        return jsonify([])
    q_vec /= q_norm
    scores = tfidf_matrix.dot(q_vec)
    top_indices = np.argsort(scores)[::-1]
    results = []
    seen = set()
    for idx in top_indices:
        score = float(scores[idx])
        if score < threshold:
            break
        m = moments[idx].copy()
        # 去重（同关键词搜索一致）
        key = _norm_moment_text(m.get("text"))
        if key in seen: continue
        seen.add(key)
        m['_score'] = round(score, 4)
        for k in ["title","text_han","text_xie","thinking","feelings","category","defining_note","stage"]:
            if k not in m: m[k] = ""
        if "timeline_order" not in m: m["timeline_order"] = m["id"]
        if "is_defining" not in m: m["is_defining"] = False
        results.append(m)
        if len(results) >= limit:
            break
    return jsonify(results)



# ── 心动时刻标星（加入上下文标星内容，压缩时保留原文） ──
MARKS_FILE = os.path.join(PROJECT_ROOT, 'data/context_compaction_marks.json')

def _load_marks():
    """[位置:backend.py·_load_marks] [读失败返回 None 而不是空表] [2026-10-27 审查 P1：原来读失败（半写/权限/编码）
    与「确实没有标星」混为一谈，紧接着的全量覆盖写会把所有历史标星清成只剩这一条；该文件与网关侧多进程共写] [注释时间 2026-10-27]"""
    if not os.path.exists(MARKS_FILE): return {}
    try:
        with open(MARKS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data.get('marks', {}) or {}
    except Exception as e:
        print('[marks] 标星文件读失败，本次不读不写以防清空:', e)
        return None

def _save_marks(marks):
    os.makedirs(os.path.dirname(MARKS_FILE), exist_ok=True)
    tmp = '%s.tmp.%s.%s' % (MARKS_FILE, os.getpid(), threading.get_ident())   # 唯一 tmp 名，防两进程互写同一 tmp（原固定 .tmp 会互相截断）
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump({'version': 1, 'marks': marks}, f, ensure_ascii=False, indent=2)
    os.replace(tmp, MARKS_FILE)

def _content_key(role, content):
    """和 context-replacements.js 的 contentKey 一致：sha256(role+\0+content) 前32位"""
    text = content or ''
    raw = (role or '') + '\x00' + text
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:32]

_MOMENT_TIME_RE = re.compile(r'(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})')

def _moment_time_iso(moment):
    """1016-03：心动的「原始时间」→ UTC ISO（与聊天标星的 time 同口径，便于统一排序）。
    优先取正文里写着的对话时间（北京时间，如 2026-08-08 23:08），否则用心动的录入时间 ts（服务器本地 CST）。"""
    cand = None
    for k in ('text', 'text_xie', 'text_han'):
        mm = _MOMENT_TIME_RE.search(str(moment.get(k) or ''))
        if mm:
            cand = mm.group(1) + 'T' + mm.group(2) + ':' + mm.group(3) + ':00'
            break
    if not cand:
        cand = str(moment.get('ts') or '').strip()
    if not cand:
        return ''
    try:
        dt = datetime.datetime.fromisoformat(cand[:19])
        dt = dt.replace(tzinfo=datetime.timezone(datetime.timedelta(hours=8)))
        return dt.astimezone(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    except Exception:
        return ''

def _utc_now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'

@todo_bp.route('/todo/api/moments/mark', methods=['POST'])
def todo_mark_moment():
    data = request.get_json(silent=True) or {}
    mid = data.get('id')
    marked = data.get('marked', True)
    if not mid:
        return jsonify({'ok': False, 'error': 'id 必填'})
    d = todo_load()
    moments = d.get('moments', [])
    moment = None
    for m in moments:
        if m.get('id') == mid:
            moment = m
            break
    if not moment:
        return jsonify({'ok': False, 'error': '未找到该心动时刻'})
    # 构造标星内容：标题 + 正文 + 感受
    parts = []
    title = moment.get('title', '')
    if title:
        parts.append(title)
    text = moment.get('text', '')
    if text:
        parts.append(text)
    feelings = moment.get('feelings', '')
    if feelings:
        parts.append('感受：' + feelings)
    note = moment.get('defining_note', '')
    if note and moment.get('is_defining'):
        parts.append('定义备注：' + note)
    content = '\n'.join(parts)
    role = 'user'  # 标星内容按 user 角色存，跟上下文里的用户消息一致
    key = _content_key(role, content)
    marks = _load_marks()
    if marks is None:
        return jsonify({'ok': False, 'error': '标星文件暂时读不了（可能正被别的进程写），稍后再试'}), 503
    if marked:
        # 同一条心动只留一份（正文改过后重标，不会叠出两条）
        for k in [k for k, e in marks.items() if isinstance(e, dict) and e.get('source') == 'heart-moment' and str(e.get('momentId')) == str(mid)]:
            del marks[k]
        marks[key] = {
            'markedAt': _utc_now_iso(),
            'time': _moment_time_iso(moment),
            'content': content,
            'role': role,
            'source': 'heart-moment',
            'momentId': mid,
            'momentTitle': title
        }
        msg = '已标星，将在上下文压缩时保留原文'
    else:
        if key in marks:
            del marks[key]
        # 按 momentId 兜底清理：心动正文改过后内容键会变，仅按 key 删会删不掉
        for k in [k for k, e in marks.items() if isinstance(e, dict) and e.get('source') == 'heart-moment' and str(e.get('momentId')) == str(mid)]:
            del marks[k]
        msg = '已取消标星'
    _save_marks(marks)
    return jsonify({'ok': True, 'marked': marked, 'key': key, 'message': msg, 'total_marked': len(marks)})

@todo_bp.route('/todo/api/moments/marked-check')
def todo_check_marked_moments():
    """批量检查哪些心动已被标星，返回 moment_id 列表"""
    marks = _load_marks()
    if marks is None: marks = {}   # 只读检查：读失败按空返回，不触发写
    marked_ids = []
    for key, entry in marks.items():
        if entry.get('source') == 'heart-moment' and entry.get('momentId'):
            marked_ids.append(entry['momentId'])
    return jsonify({'marked_ids': marked_ids, 'total': len(marked_ids)})

# ============================================================
# 注册 Blueprints
# ============================================================
app.register_blueprint(diary_bp)
app.register_blueprint(monthly_bp)
app.register_blueprint(todo_bp)

if __name__ == '__main__':
    print("统一后端服务启动: http://127.0.0.1:8777")
    app.run(host='127.0.0.1', port=8777, debug=False)  # 2026-11-10 安全加固：只走本机 nginx 反代
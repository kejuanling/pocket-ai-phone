import os, json, datetime, csv, io
from flask import Flask, request, jsonify, send_from_directory
import uuid
from datetime import datetime


app = Flask(__name__, static_folder='.', static_url_path='')
DATA = os.path.join(os.path.dirname(__file__), 'data.json')

def load():
    if not os.path.exists(DATA):
        return {}
    with open(DATA) as f:
        return json.load(f)

def save(d):
    with open(DATA, 'w') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

# 获取某日期的全部记录
@app.route('/api/records/<date>')
def get_records(date):
    d = load()
    return jsonify(d.get(date, {"finance": [], "period": None}))

# ===== 记账 =====

def guess_category(goods, record_type):
    """根据商品说明猜测分类"""
    if record_type != '支出':
        return '其他'
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
    hotel = ['酒店','住宿','民宿']
    for w in hotel:
        if w in goods: return '日用'
    learn = ['学习','课程','书','DeepSeek','API','教育','考试']
    for w in learn:
        if w in goods: return '其他'
    return '其他'

def parse_alipay(row):
    """解析支付宝账单一行"""
    try:
        ts = row.get('记录时间','').strip()
        if not ts: return None
        t = row.get('收支类型','').strip()
        amt = row.get('金额','').strip()
        if t == '支出': tp = '支出'
        elif t in ('收入','冲正收入','退款'): tp = '收入'
        else: return None
        goods = row.get('商品说明','').strip()
        return {
            "date": ts[:10], "type": tp, "amount": float(amt),
            "category": guess_category(goods, tp),
            "note": goods[:30] if len(goods)>30 else goods,
            "source": "alipay"
        }
    except: return None

def parse_wechat(row):
    """解析微信账单一行"""
    try:
        ts = row.get('交易时间','').strip()
        if not ts: return None
        d = row.get('收/支','').strip()
        if '收入' in d or '入' in d: tp = '收入'
        elif '支出' in d or '支' in d or '付' in d: tp = '支出'
        else: return None
        amt = ''
        for k in ['金额(元)','金额（元）','金额']:
            if k in row and row[k].strip(): amt = row[k].strip(); break
        goods = ''
        for k in ['商品','商品说明','交易对方']:
            if k in row and row[k].strip(): goods = row[k].strip(); break
        return {
            "date": ts[:10], "type": tp, "amount": float(amt) if amt else 0,
            "category": guess_category(goods, tp),
            "note": goods[:30] if len(goods)>30 else goods,
            "source": "wechat"
        }
    except: return None
def parse_wechat_xlsx(file_obj):
    """解析微信xlsx账单，遍历所有sheet找到数据表"""
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
                if '交易时间' in txt or '商品' in txt or '收/支' in txt:
                    headers = vals
                continue
            if not any(vals): continue
            rd = {}
            for i, v in enumerate(vals):
                if i < len(headers): rd[headers[i]] = v
            for k in list(rd.keys()):
                if '收' in k and '支' in k and k != '收/支':
                    rd['收/支'] = rd[k]
                    break
            r = parse_wechat(rd)
            if r: records.append(r)
        if headers:
            break
    wb.close()
    return records



@app.route('/api/finance/monthly')
def monthly_finance():
    year = request.args.get('year', type=int)
    month = request.args.get('month', type=int)
    now = datetime.datetime.now()
    if not year: year = now.year
    if not month: month = now.month

    d = load()
    total_income = 0.0
    total_expense = 0.0

    for date, content in d.items():
        try:
            dt = datetime.datetime.strptime(date, '%Y-%m-%d')
            if dt.year == year and dt.month == month:
                for record in content.get("finance", []):
                    amount = record.get("amount", 0)
                    if record.get("type") == "收入":
                        total_income += amount
                    else:
                        total_expense += amount
        except:
            continue

    return jsonify({
        "year": year,
        "month": month,
        "income": round(total_income, 2),
        "expense": round(total_expense, 2),
        "balance": round(total_income - total_expense, 2)
    })

@app.route('/api/finance/<date>', methods=['POST'])
def add_finance(date):
    body = request.json
    d = load()
    if date not in d:
        d[date] = {"finance": [], "period": None}
    records = d[date].setdefault("finance", [])
    new_id = max([r.get("id", 0) for r in records] + [0]) + 1
    records.append({
        "id": new_id,
        "type": body.get("type", "支出"),
        "amount": body.get("amount", 0),
        "category": body.get("category", ""),
        "note": body.get("note", ""),
        "by": body.get("by", "用户"),
        "ts": datetime.datetime.now().isoformat()
    })
    save(d)
    return jsonify({"ok": True, "id": new_id})

@app.route('/api/finance/<date>/<int:fid>', methods=['PUT'])
def update_finance(date, fid):
    body = request.json
    d = load()
    records = d.get(date, {}).get("finance", [])
    for r in records:
        if r["id"] == fid:
            if "type" in body: r["type"] = body["type"]
            if "amount" in body: r["amount"] = body["amount"]
            if "category" in body: r["category"] = body["category"]
            if "note" in body: r["note"] = body["note"]
            r["edited_at"] = datetime.datetime.now().isoformat()
            save(d)
            return jsonify({"ok": True})
    return jsonify({"error": "not found"}), 404

@app.route('/api/finance/<date>/<int:fid>', methods=['DELETE'])
def delete_finance(date, fid):
    d = load()
    records = d.get(date, {}).get("finance", [])
    d[date]["finance"] = [r for r in records if r["id"] != fid]
    save(d)
    return jsonify({"ok": True})



@app.route('/api/finance/import', methods=['POST'])
def import_finance():
    if 'file' not in request.files:
        return jsonify({"error": "请上传文件"}), 400
    f = request.files['file']
    tp = request.form.get('type', 'alipay')
    confirm = request.form.get('confirm', 'false').lower() == 'true'
    if not f.filename:
        return jsonify({"error": "文件名为空"}), 400
    
    filename = f.filename.lower()
    records = []
    
    if filename.endswith('.xlsx'):
        records = parse_wechat_xlsx(f)
    else:
        raw = f.read()
        text = None
        for enc in ['gbk', 'gb18030', 'utf-8']:
            try: text = raw.decode(enc); break
            except: continue
        if not text:
            return jsonify({"error": "无法识别文件编码"}), 400
        lines = text.split('\n')
        start = 0
        for i, line in enumerate(lines):
            if '记录时间' in line or '交易时间' in line:
                start = i; break
        reader = csv.DictReader(io.StringIO('\n'.join(lines[start:])))
        for row in reader:
            r = parse_alipay(row) if tp == 'alipay' else parse_wechat(row)
            if r: records.append(r)
    
    if not records:
        return jsonify({"error": "未能解析到有效记录，请检查文件格式", "records": []}), 400
    if not confirm:
        return jsonify({"total": len(records), "records": records[:200]})
    d = load()
    written = 0
    for r in records:
        date = r['date']
        if date not in d: d[date] = {"finance": [], "period": None}
        recs = d[date].setdefault("finance", [])
        nid = max([x.get("id",0) for x in recs] + [0]) + 1
        recs.append({"id": nid, "type": r['type'], "amount": r['amount'],
                     "category": r['category'], "note": r['note'], "by": "用户",
                     "ts": datetime.datetime.now().isoformat(), "imported": True})
        written += 1
    save(d)
    return jsonify({"ok": True, "total": len(records), "written": written})


# ===== 经期记录 =====

@app.route('/api/period/<date>', methods=['POST'])
def set_period(date):
    body = request.json
    d = load()
    if date not in d:
        d[date] = {"finance": [], "period": None}
    d[date]["period"] = {
        "on_period": body.get("on_period", False),
        "flow": body.get("flow", ""),
        "note": body.get("note", ""),
        "by": body.get("by", "用户"),
        "updated_at": datetime.datetime.now().isoformat()
    }
    save(d)
    return jsonify({"ok": True})

@app.route('/api/period/<date>', methods=['DELETE'])
def delete_period(date):
    d = load()
    if date in d and d[date].get("period"):
        d[date]["period"] = None
        save(d)
    return jsonify({"ok": True})

# ===== 获取所有有记录的日期（用于月历标记） =====

@app.route('/api/markers')
def get_markers():
    d = load()
    finance_dates = set()
    period_dates = set()
    summary_dates = set()
    for date, content in d.items():
        if date == "2026-07-05":
            continue
        if content.get("finance") and len(content["finance"]) > 0:
            finance_dates.add(date)
        if content.get("period") and content["period"].get("on_period"):
            period_dates.add(date)
        if content.get("summary") and content["summary"].get("text"):
            summary_dates.add(date)
    return jsonify({
        "finance": sorted(list(finance_dates)),
        "period": sorted(list(period_dates)),
        "summary": sorted(list(summary_dates))
    })

# ===== 今日总结 =====

@app.route('/api/summary/<date>', methods=['GET', 'POST'])
def handle_summary(date):
    if request.method == 'GET':
        d = load()
        entry = d.get(date, {})
        s = entry.get("summary", {})
        return jsonify({
            "text": s.get("text", ""),
            "by": s.get("by", ""),
            "updated_at": s.get("updated_at", "")
        })
    else:
        body = request.json
        text = body.get("text", "").strip()
        if not text:
            return jsonify({"error": "内容不能为空"}), 400
        d = load()
        if date not in d:
            d[date] = {"finance": [], "period": None}
        by = body.get("by", "用户")
        d[date]["summary"] = {
            "text": text,
            "by": by,
            "updated_at": datetime.datetime.now().isoformat()
        }
        save(d)
        return jsonify({"ok": True})

if __name__ == '__main__':
    print("🚀 月历服务启动 http://0.0.0.0:8770")
    app.run(host='0.0.0.0', port=8770, debug=False)

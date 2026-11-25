import os, json, datetime
from flask import Flask, request, jsonify, send_from_directory
import urllib.request, urllib.parse

app = Flask(__name__, static_folder='.', static_url_path='')
DATA = os.path.join(os.path.dirname(__file__), 'diary.json')
BARK_KEY = "Sdy75H8X8AnBpeEicdQMTa"
BARK_URL = f"https://api.day.app/{BARK_KEY}/"

def load():
    if not os.path.exists(DATA): return {"entries": []}
    with open(DATA) as f: return json.load(f)
def save(d):
    with open(DATA, 'w') as f: json.dump(d, f, ensure_ascii=False, indent=2)

def bark(title, body):
    try:
        url = BARK_URL + urllib.parse.quote(title) + "/" + urllib.parse.quote(body) + "?group=diary"
        urllib.request.urlopen(url, timeout=2)
    except: pass

@app.route('/')
def idx(): return send_from_directory('.', 'index.html')

@app.route('/api/entries')
def get_entries():
    d = load()
    return jsonify(sorted(d["entries"], key=lambda x: x["ts"], reverse=True))

@app.route('/api/entries/add', methods=['POST'])
def add_entry():
    body = request.json; text = body.get("text","").strip()
    if not text: return jsonify({"error":"empty"}),400
    d = load()
    now = datetime.datetime.now().isoformat()
    entry = {"id": len(d["entries"])+1, "text": text, "ts": now, "comments": []}
    d["entries"].insert(0, entry)
    save(d)
    pass  # no bark when she writes
    return jsonify({"ok": True, "id": entry["id"]})

@app.route('/api/entries/edit', methods=['POST'])
def edit_entry():
    body = request.json; eid = body.get("id"); text = body.get("text","").strip()
    if not text: return jsonify({"error":"empty"}),400
    d = load()
    for e in d["entries"]:
        if e["id"] == eid: e["text"] = text; e["edited"] = True; save(d); return jsonify({"ok":True})
    return jsonify({"error":"not found"}),404

@app.route('/api/entries/delete', methods=['POST'])
def delete_entry():
    body = request.json; eid = body.get("id")
    d = load()
    d["entries"] = [e for e in d["entries"] if e["id"] != eid]
    save(d); return jsonify({"ok": True})

@app.route('/api/entries/comment', methods=['POST'])
def add_comment():
    body = request.json; eid = body.get("id"); text = body.get("text","").strip()
    author = body.get("author","xie")
    if not text: return jsonify({"error":"empty"}),400
    d = load()
    for e in d["entries"]:
        if e["id"] == eid:
            e["comments"].append({"author": author, "text": text, "ts": datetime.datetime.now().isoformat()})
            save(d)
            if author == "xie":
                # Notify user when assistant replies
                bark("助手回复了你", text[:40])
            return jsonify({"ok": True})
    return jsonify({"error":"not found"}),404

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8769, debug=False)

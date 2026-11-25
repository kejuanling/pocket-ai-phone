# [位置:lib/project_root.py] [发布树项目根目录] [Python 服务与脚本共用，优先环境变量，否则向上查找 package.json] [注释时间 2026-11-25]
import os


def project_root():
    env = (os.environ.get("PROJECT_ROOT") or "").strip()
    if env:
        return os.path.abspath(env)
    cur = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    for _ in range(8):
        if os.path.exists(os.path.join(cur, "package.json")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

#!/usr/bin/env bash
# 8771（工具集合）由 systemd 托管：mcp-tools.service
# 2026-10-20 修正：原内容是 `nohup python3 tools_server.py &`，照跑会与 systemd 抢 8771 端口，
# 产生重复进程和混乱日志。现在只做重启转发，不再自己拉进程。
set -e
exec systemctl restart mcp-tools.service

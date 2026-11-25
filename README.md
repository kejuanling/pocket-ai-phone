# 小手机 · AI 个人助手（AI Phone Assistant）

一个可独立部署的 AI 个人助手与移动端 Web 工作台，集成了对话网关、记忆管理、上下文压缩、定时唤醒、Web Push / Bark 推送、自定义主题以及可扩展的 MCP 工具链。

## 主要特性

- **移动端 Web 工作台**：`workspace/phone-new.html` 提供主屏、锁屏、气泡与极简双聊天主题、主题自定义、日记、待办、月历、笔记、相册与管理台。
- **多模型与代理出口保护**：支持接入多家模型供应商；海外模型路径内置 fail-closed 出口保护，未配置或出口 IP 不符时自动拒绝，不静默回退直连。
- **可配置称呼与空白人设起步**：默认使用中性称呼（`用户` / `助手`），可在主题页直接修改称呼与头像；项目不包含任何私人提示词或用户数据，部署后可在人设页自行填写。
- **可选伴随服务**：提供 Python 小世界后台（`little-world/backend.py`）、工具服务（`ai-toolbox/tools_server.py`）和可选 MCP 服务（`yun-mcp-v2/mcp_server.py`）。

## 环境要求

- Node.js >= 20（建议 20 或 22/24）
- Python >= 3.11（仅在启用 Python 伴随服务时需要）
- 可选：PM2（`npm i -g pm2`）用于后台进程守护

## 快速开始

### 1. 安装依赖

```bash
npm install
```

如需启用 Python 伴随服务（日记 / 待办 / 月历 / 工具服务），建议在独立虚拟环境中安装依赖：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. 初始化配置

复制环境变量模板并按需填写本地值（不要把 `.env` 提交到仓库）：

```bash
cp .env.example .env
```

如需预先提供主题称呼与空人设配置，可复制示例文件到 `config/chat-settings.json`：

```bash
mkdir -p config data
cp config.example/chat-settings.example.json config/chat-settings.json
```

关键环境变量说明（详见 `.env.example`）：

| 变量名 | 说明 |
| --- | --- |
| `LISTEN_HOST` | HTTP 监听地址，默认 `127.0.0.1` |
| `PROJECT_ROOT` | 项目根目录，留空时自动向上查找 `package.json` |
| `USER_DISPLAY_NAME` / `AI_DISPLAY_NAME` | 上下文与推送显示称呼；留空时自动回退到 `config/chat-settings.json` 的主题称呼，再默认 `用户` / `助手` |
| `EGRESS_PROXY` / `EGRESS_EXPECT_IP` | 海外模型代理地址与预期出口公网 IP；缺配置时海外请求按 fail-closed 拒绝 |
| `PUBLIC_BASE_URL` | 若经反向代理对外提供服务，可填写公开访问地址 |

### 3. 启动服务

直接前台启动网关：

```bash
npm start
```

或使用 PM2 启动（`ecosystem.config.js` 会拉起 `gateway` 与 `state-worker`；若本地安装了可选的 `embed-server/embed-server.js` 也会一并拉起，缺失时自动跳过）：

```bash
pm2 start ecosystem.config.js
```

启动后访问本地地址（默认 `http://127.0.0.1:3000`），静态前端位于 `workspace/phone-new.html`。

## 无凭据冷启动行为

- 首次启动会在本地 `data/` 目录按需初始化运行数据，不依赖预置生产数据。
- 未配置模型供应商或 OAuth 客户端时，对应通道自动不可用并返回明确提示，服务本身正常启动。
- 未配置私人提示词时，聊天主链路以空人设骨架运行，部署者可在设置/人设页自行添加提示词。
- 未配置海外代理或预期出口 IP 时，出口保护保持 fail-closed，不会回退到硬编码代理或直连。

## 目录结构

- `server.js` / `state-worker.js`：主网关与后台状态机进程
- `routes/`、`lib/`、`context/`、`memory/`、`utils/`、`mcp/`：后端路由、上下文、记忆与工具封装
- `workspace/`：小手机前端页面、样式、脚本与静态字体资源
- `admin/`：管理台界面
- `little-world/`、`ai-toolbox/`、`yun-mcp-v2/`：可选 Python 伴随服务
- `config.example/`：不含私人内容的配置示例
- `docs/COMMENT_STYLE.md`：代码注释规范
- `tests/`：单元测试与隔离验证脚本

## 测试

```bash
npm test
```

## 备份与更新

建议定期备份本地 `data/`、`config/` 与 `.env`（以上路径均已列入 `.gitignore`，不会进入 Git 仓库）。更新代码前先停止服务并备份本地数据目录。

## 许可证与第三方声明

- 本项目采用 **PolyForm Noncommercial License 1.0.0**，详见 [LICENSE](LICENSE)。
- 前端引用的第三方字体许可说明详见 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)。

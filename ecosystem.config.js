const fs = require("fs");
const path = require("path");
const PROJECT_ROOT = require("./lib/project-root").projectRoot();

const apps = [
  {
    name: "gateway",
    script: "server.js",
    cwd: PROJECT_ROOT,
    interpreter: "node",
    autorestart: true,
    time: true,
    max_memory_restart: "1200M",
    kill_timeout: 65000,
    env: { MALLOC_ARENA_MAX: "2" },
  },
  {
    name: "state-worker",
    script: "state-worker.js",
    cwd: PROJECT_ROOT,
    interpreter: "node",
    autorestart: true,
    time: true,
    max_memory_restart: "900M",
    kill_timeout: 125000,
  },
];

// Optional local embedding service: only included when embed-server/embed-server.js is installed.
const embedScript = path.join(PROJECT_ROOT, "embed-server", "embed-server.js");
if (fs.existsSync(embedScript)) {
  apps.push({
    name: "embed-server",
    script: "embed-server/embed-server.js",
    cwd: PROJECT_ROOT,
    interpreter: "node",
    autorestart: true,
    time: true,
    max_memory_restart: "600M",
  });
}

module.exports = { apps };

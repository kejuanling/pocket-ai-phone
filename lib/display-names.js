"use strict";

const fs = require("fs");
const path = require("path");
const { projectRoot } = require("./project-root");

const DEFAULT_USER_NAME = "用户";
const DEFAULT_AI_NAME = "助手";

let _cache = { file: "", mtimeMs: -1, user: "", ai: "" };

function readChatSettingsNames(configPath) {
  const file = configPath || path.join(projectRoot(), "config", "chat-settings.json");
  try {
    const st = fs.statSync(file);
    if (_cache.file === file && _cache.mtimeMs === st.mtimeMs) {
      return { user: _cache.user, ai: _cache.ai };
    }
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const cfg = (raw && typeof raw.cfg === "object" && raw.cfg) ? raw.cfg : (raw || {});
    const user = typeof cfg.user_name === "string" ? cfg.user_name.trim() : "";
    const ai = typeof cfg.ai_name === "string" ? cfg.ai_name.trim() : "";
    _cache = { file, mtimeMs: st.mtimeMs, user, ai };
    return { user, ai };
  } catch {
    return { user: "", ai: "" };
  }
}

function getDisplayNames(opts) {
  const options = opts || {};
  const env = options.env || process.env;
  const envUser = typeof env.USER_DISPLAY_NAME === "string" ? env.USER_DISPLAY_NAME.trim() : "";
  const envAi = typeof env.AI_DISPLAY_NAME === "string" ? env.AI_DISPLAY_NAME.trim() : "";
  let fileNames = null;
  const loadFile = () => {
    if (!fileNames) fileNames = readChatSettingsNames(options.configPath);
    return fileNames;
  };
  const user = envUser || loadFile().user || DEFAULT_USER_NAME;
  const ai = envAi || loadFile().ai || DEFAULT_AI_NAME;
  return { user, ai };
}

function getUserDisplayName(opts) {
  return getDisplayNames(opts).user;
}

function getAiDisplayName(opts) {
  return getDisplayNames(opts).ai;
}

function clearDisplayNamesCache() {
  _cache = { file: "", mtimeMs: -1, user: "", ai: "" };
}

module.exports = {
  DEFAULT_USER_NAME,
  DEFAULT_AI_NAME,
  getDisplayNames,
  getUserDisplayName,
  getAiDisplayName,
  clearDisplayNamesCache,
};

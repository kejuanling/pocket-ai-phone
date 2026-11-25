"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const test = require("node:test");

const SRC = path.resolve(__dirname, "..", "..");
const displayNames = require(path.join(SRC, "lib", "display-names.js"));

test("display-names defaults when env and chat-settings are absent", () => {
  const missing = path.join(os.tmpdir(), "nonexistent-chat-settings-" + Date.now() + ".json");
  displayNames.clearDisplayNamesCache();
  const res = displayNames.getDisplayNames({ env: {}, configPath: missing });
  assert.deepStrictEqual(res, { user: "用户", ai: "助手" });
});

test("display-names falls back to chat-settings.json when env is empty, and env overrides file", () => {
  const tmpFile = path.join(os.tmpdir(), "test-chat-settings-" + Date.now() + ".json");
  fs.writeFileSync(
    tmpFile,
    JSON.stringify({ cfg: { user_name: "小明", ai_name: "小智" } }),
    "utf8"
  );
  try {
    displayNames.clearDisplayNamesCache();
    assert.deepStrictEqual(
      displayNames.getDisplayNames({ env: { USER_DISPLAY_NAME: "", AI_DISPLAY_NAME: "" }, configPath: tmpFile }),
      { user: "小明", ai: "小智" }
    );
    assert.deepStrictEqual(
      displayNames.getDisplayNames({ env: { USER_DISPLAY_NAME: "访客", AI_DISPLAY_NAME: "" }, configPath: tmpFile }),
      { user: "访客", ai: "小智" }
    );
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test(".env.example and config.example/chat-settings.example.json contain clean neutral defaults", () => {
  const envEx = fs.readFileSync(path.join(SRC, ".env.example"), "utf8");
  assert.match(envEx, /^USER_DISPLAY_NAME=\s*$/m);
  assert.match(envEx, /^AI_DISPLAY_NAME=\s*$/m);

  const cfgEx = JSON.parse(
    fs.readFileSync(path.join(SRC, "config.example", "chat-settings.example.json"), "utf8")
  );
  assert.strictEqual(cfgEx.system_prompt, "");
  assert.strictEqual(cfgEx.cfg.user_name, "用户");
  assert.strictEqual(cfgEx.cfg.ai_name, "助手");
  assert.strictEqual(cfgEx.cfg.user_avatar, "");
  assert.strictEqual(cfgEx.cfg.ai_avatar, "");
});

test("phone-new.html removes personal defaults, anniversary date, and live avatar URLs", () => {
  const html = fs.readFileSync(path.join(SRC, "workspace", "phone-new.html"), "utf8");
  assert.ok(html.includes('id="homePairNm">用户 &amp; 助手</div>'));
  assert.ok(html.includes("你好，我在这儿。"));
  assert.strictEqual(html.includes("谢意行"), false);
  assert.strictEqual(html.includes("2026.07.02"), false);
  assert.strictEqual(html.includes("new Date(2026,6,2"), false);
  assert.strictEqual(html.includes("/uploads/img-mu9ojyma"), false);
  assert.strictEqual(html.includes("/uploads/img-mu9ok9in"), false);
});

test("updated workspace UI files contain no hardcoded personal display names", () => {
  const files = [
    "workspace/phone-profile.js",
    "workspace/phone-talk.js",
    "workspace/phone-call.js",
    "workspace/phone-diary.js",
    "workspace/phone-todo.js",
    "workspace/phone-drawer.js",
    "workspace/phone-chats.js",
    "workspace/phone-pages.js",
    "workspace/phone-cal.js",
    "workspace/phone-tools.js",
    "workspace/phone-trace.js",
    "workspace/phone-nw-widgets.js",
    "workspace/index.html",
    "workspace/sw.js",
  ];
  for (const rel of files) {
    const content = fs.readFileSync(path.join(SRC, rel), "utf8");
    assert.strictEqual(content.includes("谢意行"), false, rel + " still contains 谢意行");
    assert.strictEqual(content.includes("涵"), false, rel + " still contains 涵");
  }
});

test("phone-profile.js initializes P.names defaults and syncs chrome DOM on update", () => {
  const pairEl = { textContent: "" };
  const lkNmEl = { textContent: "" };
  const avMe = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const avAi = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const events = [];
  const sandbox = {
    window: { PH: { D: {}, toast() {} } },
    document: {
      documentElement: { style: { setProperty() {}, removeProperty() {} } },
      getElementById(id) {
        if (id === "homePairNm") return pairEl;
        if (id === "lkNotiNm") return lkNmEl;
        return null;
      },
      querySelectorAll(sel) {
        if (sel.includes(".av.me")) return [avMe];
        if (sel.includes(".av.ai")) return [avAi];
        return [];
      },
      dispatchEvent(ev) { events.push(ev); },
    },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    Promise,
    Array,
    String,
    Object,
  };
  const code = fs.readFileSync(path.join(SRC, "workspace", "phone-profile.js"), "utf8");
  vm.runInNewContext(code, sandbox);
  const P = sandbox.window.PH;
  assert.strictEqual(P.names.me(), "用户");
  assert.strictEqual(P.names.ai(), "助手");
  assert.strictEqual(P.names.letter("me"), "用");
  assert.strictEqual(P.names.letter("ai"), "助");
  assert.strictEqual(pairEl.textContent, "用户 & 助手");
  assert.strictEqual(lkNmEl.textContent, "助手");
  assert.strictEqual(avMe.attrs["data-l"], "用");
  assert.strictEqual(avAi.attrs["data-l"], "助");

  P.names.set({ user_name: "星河", ai_name: "云舟" });
  assert.strictEqual(pairEl.textContent, "星河 & 云舟");
  assert.strictEqual(lkNmEl.textContent, "云舟");
  assert.strictEqual(avMe.attrs["data-l"], "星");
  assert.strictEqual(avAi.attrs["data-l"], "云");
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, "ph:names");
});

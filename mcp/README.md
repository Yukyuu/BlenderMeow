# Blender Meow Live 3D Studio MCP Server (`v1.3.2`)

零外部 npm 依赖的标准 PC 端 `stdio` MCP 服务，让 **Antigravity / Claude Code / Cursor / Codex CLI / Gemini CLI / Windsurf** 等任意 AI Harness 直接通过结构化 3D 参数构建 TheoTown 建筑体块、编辑拱形与曲面柱截面、贴附自定义像素材质，并一键将分层 PSD 或四向视角图层无缝传送至 **Pixel Meow** 实时画布进行阴影、玻璃高光与像素细化。

---

## 一、前置准备

1. 已安装 Node.js >= 18。
2. 在仓库根目录执行一次 MCP Sidecar 单文件构建（生成 `dist/blendermeow-mcp.html`）：
   ```bash
   npm run build:mcp
   ```

---

## 二、主流 AI Harness 接入配置

### 1. Claude Code（`.mcp.json` 或 `~/.claude.json`）

```json
{
  "mcpServers": {
    "blendermeow-studio": {
      "command": "node",
      "args": ["d:/Documents/agy/builderMeow/mcp/blendermeow-mcp.mjs"]
    }
  }
}
```

### 2. Cursor（`~/.cursor/mcp.json` 或工作区 `.cursor/mcp.json`）

```json
{
  "mcpServers": {
    "blendermeow-studio": {
      "command": "node",
      "args": ["d:/Documents/agy/builderMeow/mcp/blendermeow-mcp.mjs"]
    }
  }
}
```

### 3. OpenAI Codex CLI（`~/.codex/config.toml`）

```toml
[mcp_servers.blendermeow_studio]
command = "node"
args = ["d:/Documents/agy/builderMeow/mcp/blendermeow-mcp.mjs"]
```

### 4. Gemini CLI（`~/.gemini/settings.json`）

```json
{
  "mcpServers": {
    "blendermeow-studio": {
      "command": "node",
      "args": ["d:/Documents/agy/builderMeow/mcp/blendermeow-mcp.mjs"]
    }
  }
}
```

### 5. Antigravity（反重力桌面端）

已配置完整插件 `C:\Users\akie\.gemini\config\plugins\blender-meow\`，内置：
- 右侧分屏 Sidecar 建模工坊（`sidecars/blender_studio/`）
- MCP Server `blendermeow_studio`（`#M1–#M10`，默认设置 `BLENDERMEOW_AUTO_OPEN=false` 以配合 Sidecar，需要自动弹出独立浏览器窗时可移除该环境变量）
- 专项技能 `blender-meow-architect` 与交互规范 `rules/AGENTS.md`

---

## 三、双画板联动（Blender Meow ⇄ Pixel Meow）

- **Blender Meow 本地守护端口**：`127.0.0.1:17921`（可通过 `BLENDERMEOW_MCP_PORT` 覆盖，与 Pixel Meow 的 `17920` 互不冲突）。
- **AI 一键传层**：调用 `#M10 studio_handoff_to_pixelmeow` 可自动导出：
  - `all_layers`：完整分层 PSD 直接在 Pixel Meow 打开为多图层工程或并入当前画布；
  - `selected_layers`：仅传送指定/当前建筑模块图层；
  - `four_views`：`0° / 90° / 180° / 270°` 四向旋转图层 PSD；
  - `flat_png`：合并无锯齿 PNG 贴入当前画布指定坐标。
- **用户手工一键传层**：在 Sidecar 界面点击顶部「🚀 导入 Pixel Meow」同样走本地 Hub `/api/mcp/handoff_pixelmeow` 通道直传 Pixel Meow 画板。

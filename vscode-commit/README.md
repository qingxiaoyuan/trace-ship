# 规范提交助手

一个 VS Code 侧边栏插件，通过 AI 自动生成符合规范的 commit 信息。

## 功能特性

- **AI 智能生成** — 调用 AI 接口生成符合规范的 commit 信息，自动识别功能增加(A)/BUG 修复(F)
- **完整规范模板** — 含变更类型、更新内容、配置项改动、24 项关联性改动版本字段
- **大尺寸 Message 框** — 自适应高度（最小 240px，按内容增长至约 70vh），查看大部分提交内容
- **配置项改动勾选** — 一键切换「无/有配置项改动」，AI 据此生成对应勾选状态
- **变更统计** — 文件数、新增行数、删除行数实时统计
- **变更文件管理** — 暂存/取消暂存/放弃更改/打开 diff 视图
- **多种提交模式** — Commit / Commit & Push / Commit & Sync
- **规范模板插入** — 一键填入空白模板，手动编辑也能合规

## 安装

1. 在插件目录执行 `npm install && npm run compile`
2. 按 `F5` 启动调试，或打包为 `.vsix` 安装

## 配置

在 VS Code 设置中搜索 `commit`，配置以下选项。插件采用**标准 OpenAI Chat Completions 协议**，兼容 OpenAI / DeepSeek / 通义千问 / 本地 Ollama 等任何兼容服务：

```json
{
  "commit.apiEndpoint": "https://api.openai.com",
  "commit.apiKey": "your-api-key",
  "commit.model": "gpt-4o-mini"
}
```

`apiEndpoint` 只填到根域名即可，插件会自动拼接 `/v1/chat/completions`；若填入完整路径（如 `https://api.deepseek.com/v1/chat/completions`）则直接使用。常见服务示例：

| 服务 | apiEndpoint | model |
|---|---|---|
| OpenAI | `https://api.openai.com` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode` | `qwen-plus` |
| 本地 Ollama | `http://localhost:11434/v1` | `qwen2.5:7b` |

## 使用方法

1. 打开侧边栏「规范提交助手」视图
2. 在设置中配置 AI API 密钥
3. 选择「变更类型」：无配置项改动 / 有配置项改动
4. 修改代码后，点击 **✦ AI 生成 Commit**
5. 插件自动获取 git diff 并生成规范 commit，填入 Message 框
6. 按需点击 **⧉ 复制** 或 **✓ Commit**（含下拉的 Push / Sync 模式）

## Commit 规范格式

```
变更类型：
□ 无配置项改动 ☑ 有配置项改动

更新内容：
[A 为功能增加 F 为 BUG 修复]：

1. A [具体功能描述]
2. F [具体修复描述]

配置项改动[详见相关软件配置文件管理]：
[System]
DeviceType=0

关联性改动[选填]：
PXX板卡硬件版本:
信号子模块硬件版本:
...
阵列天线上位机软件版本:
```

## 开发

```bash
npm install      # 安装依赖
npm run compile  # 编译
npm run watch    # 监听模式
```

按 `F5` 启动调试宿主。

## 技术栈

- TypeScript
- VS Code Extension API（Webview + 内置 Git 扩展 API）
- AI API 集成（标准 OpenAI Chat Completions 协议）

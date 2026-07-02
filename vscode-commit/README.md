# 规范提交助手 —— 快速上手指册

> 一个 VS Code 侧边栏插件，通过 AI 自动生成符合团队规范的 commit 信息。

---

## 目录

1. [它能做什么](#它能做什么)
2. [一分钟快速开始](#一分钟快速开始)
3. [安装插件](#安装插件)
4. [配置 AI 服务](#配置-ai-服务)
5. [日常使用流程](#日常使用流程)
6. [界面功能说明](#界面功能说明)
7. [Commit 规范格式](#commit-规范格式)
8. [支持的服务与模型](#支持的服务与模型)
9. [常见问题](#常见问题)

---

## 它能做什么

| 能力                   | 说明                                                |
| ---------------------- | --------------------------------------------------- |
| **AI 智能生成 Commit** | 读取当前 git diff，调用 AI 自动生成规范提交信息     |
| **自动识别提交类型**   | 区分功能增加（`A`）与 BUG 修复（`F`）               |
| **简化规范格式**       | 仅保留「更新内容」段，支持单行与列表两种形式        |
| **变更文件管理**       | 在侧边栏直接 暂存 / 取消暂存 / 放弃更改 / 打开 diff |
| **多种提交模式**       | Commit / Commit & Push / Commit & Sync              |
| **规范模板插入**       | 一键填入空白模板，手动编辑也能合规                  |
| **大尺寸编辑框**       | 消息框最小 240px，最高约 70vh，便于查看长提交       |
| **图片变更预览**       | 点击 PNG/JPG 等图片文件，在侧边栏内直接预览；修改的图片支持 HEAD 对比 |

---

## 一分钟快速开始

1. 安装并启用插件（见 [安装插件](#安装插件)）。
2. 打开 VS Code 设置，搜索 `commit`，填写 `commit.apiKey` 和 `commit.apiEndpoint`（见 [配置 AI 服务](#配置-ai-服务)）。
3. 修改代码后，在左侧活动栏点击 **规范提交助手** 图标打开侧边栏。
4. 点击 **✦ AI 生成 Commit**，稍等片刻即可在 Message 框看到生成的提交信息。
5. 确认无误后，点击 **✓ Commit** 仅提交；点击右侧下拉箭头可选择 **Commit & Push** 或 **Commit & Sync**。

---

## 安装插件

1. 获取插件的 `.vsix` 安装包。
2. 在 VS Code 中打开侧边栏 **扩展**（快捷键 `Ctrl+Shift+X` / `Cmd+Shift+X`）。
3. 点击顶部 `⋯` → **从 VSIX 安装**。
   <!-- 配图位置：扩展面板 → 从 VSIX 安装 -->
4. 选择 `.vsix` 文件完成安装。

---

## 配置 AI 服务（已默认配置）

打开 VS Code 设置（`Ctrl+,` / `Cmd+,`），搜索 `commit`，按需填写以下项：

| 配置项               | 必填 | 说明                                      |
| -------------------- | ---- | ----------------------------------------- |
| `commit.apiEndpoint` | 是   | AI 服务根地址，插件会根据路径自动识别协议 |
| `commit.apiKey`      | 是   | 你的 API 密钥                             |
| `commit.model`       | 是   | 使用的模型名称                            |

### 配置示例

```json
{
  "commit.apiEndpoint": "https://api.minimaxi.com/anthropic",
  "commit.apiKey": "your-api-key",
  "commit.model": "MiniMax-M2.7"
}
```

### 协议自动识别规则

插件会根据 `apiEndpoint` 自动选择调用方式：

- 路径包含 `/anthropic` → 使用 **Anthropic Messages API**（MiniMax 兼容模式）
- 其他 → 使用标准 **OpenAI Chat Completions API**

`apiEndpoint` 填写到根路径即可，插件会自动拼接 `/v1/messages` 或 `/v1/chat/completions`；如果填写了完整路径，则直接使用。

### 常用服务速查

| 服务                     | apiEndpoint                          | model           | 协议                    |
| ------------------------ | ------------------------------------ | --------------- | ----------------------- |
| MiniMax (Anthropic 兼容) | `https://api.minimaxi.com/anthropic` | `MiniMax-M2.7`  | Anthropic Messages      |
| MiniMax (OpenAI 兼容)    | `https://api.minimaxi.com/v1`        | `MiniMax-M2.7`  | OpenAI Chat Completions |
| OpenAI                   | `https://api.openai.com`             | `gpt-4o-mini`   | OpenAI Chat Completions |
| DeepSeek                 | `https://api.deepseek.com`           | `deepseek-chat` | OpenAI Chat Completions |

---

## 日常使用流程

### 1. 打开侧边栏

点击 VS Code 左侧活动栏的 **规范提交助手** 图标，打开提交视图。

<!-- 配图位置：活动栏中的插件图标 -->

### 2. 查看变更文件

- 所有已修改、已暂存、未跟踪的文件会显示在侧边栏列表中。
- 点击文件即可在编辑器中打开。

### 3. 管理变更

在文件项上可操作：

- **暂存 / 取消暂存**：控制文件是否进入暂存区。
- **放弃更改**：撤销对该文件的修改（谨慎使用）。
- **打开 Diff**：查看文本文件的改动内容。
- **图片预览**：点击图片文件（PNG、JPG、GIF、WebP、SVG 等）会在侧边栏内直接预览；已修改图片支持“对比 HEAD”查看变更前后。

### 4. 生成 Commit Message

点击 **✦ AI 生成 Commit**：

1. 插件读取当前工作区的 git diff。
2. 调用 AI 接口生成规范提交信息。
3. 自动填入 Message 输入框。

> 提示：建议至少先暂存关键文件，以便 AI 更准确地理解提交意图。

### 5. 提交代码

- **⧉ 复制**：将生成的 commit 信息复制到剪贴板。
- **✓ Commit**：直接提交。
- **下拉箭头**：可选择 **Commit & Push** 或 **Commit & Sync**。

---

## 界面功能说明

```
┌─────────────────────────────┐
│      规范提交助手            │
├─────────────────────────────┤
│ ✦ AI 生成 Commit            │
│ ⧉ 复制                       │
│ ✓ Commit ▾                  │
├─────────────────────────────┤
│ 变更文件                      │
│  ☐ src/foo.ts          [+]  │
│  ☑ src/bar.ts          [-]  │
├─────────────────────────────┤
│ 更新内容：                    │
│ [A为功能增加 F为BUG修复]：   │
│ <feat> A 新增 xxx 功能      │
│                              │
│ (大尺寸 Message 编辑框)      │
└─────────────────────────────┘
```

---

## Commit 规范格式

本插件生成的 commit 仅保留「更新内容」段，格式如下：

### 单行提交

```
更新内容：
[A为功能增加 F为BUG修复]：

<feat> A 具体功能描述
或
<fix> F 具体修复描述
```

当同时包含 A 和 F 时，可用 `|` 连接：

```
<feat> A 具体功能描述 | <fix> F 具体修复描述
```

### 复杂提交（多行列表）

```
更新内容：
[A为功能增加 F为BUG修复]：

<feat> 提交了xxx

1. A 具体功能描述
2. F 具体修复描述
```

### 手动编辑模板

点击 **插入模板** 可一键填入空白模板，手动填写时也能保持合规。

---

## 支持的服务与模型

当前已验证可用的服务组合：

| 服务     | 推荐模型        | 备注                                 |
| -------- | --------------- | ------------------------------------ |
| MiniMax  | `MiniMax-M2.7`  | 支持 Anthropic / OpenAI 两种兼容协议 |
| OpenAI   | `gpt-4o-mini`   | 成本低、速度快                       |
| DeepSeek | `deepseek-chat` | 国产大模型，中文理解较好             |

如使用其他兼容 OpenAI 接口的服务，通常只需替换 `apiEndpoint` 和 `apiKey` 即可。

---

## 常见问题

### Q1：点击「AI 生成 Commit」没有反应？

1. 检查设置中的 `commit.apiKey` 是否已填写。
2. 检查 `commit.apiEndpoint` 是否正确。
3. 打开 VS Code 输出面板（`Ctrl+Shift+U` / `Cmd+Shift+U`），查看是否有网络或 API 报错。
4. 确认当前工作区是一个 git 仓库，且存在可提交的变更。

### Q2：生成的 commit 信息不符合预期？

- 确保关键变更文件已暂存，AI 会根据 diff 内容生成描述。
- 如果一次变更包含多种类型（feat + fix），可尝试拆分为多次提交。
- 可点击 **插入模板** 手动修改后再提交。

### Q3：如何切换 AI 服务？

直接修改 `commit.apiEndpoint`、`commit.apiKey`、`commit.model` 三项即可，插件会自动识别协议。

### Q4：支持哪些提交命令？

- `Commit`：仅执行 `git commit`
- `Commit & Push`：提交后推送至远程
- `Commit & Sync`：拉取、合并后提交并推送

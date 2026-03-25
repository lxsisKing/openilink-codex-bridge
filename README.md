# openilink-codex-bridge

基于 **OpenILink Hub** 的本地 bridge 服务，用来把不同 channel 的消息路由到不同 agent（如 `codex` / `review` / `chat`），并将处理结果通过 OpenILink 回传到微信侧。

这个项目适合下面这类场景：

- 一个微信 Bot，对接多个 agent 能力
- 代码执行、代码审查、技术问答分角色处理
- 通过 OpenILink Hub 统一接入消息，再在本机桥接到本地 agent / CLI

---

## 核心能力

- 连接多个 OpenILink channel WebSocket
- 支持按 agent/channel 做消息路由
- 支持 `@codex` / `@review` / `@chat` 前缀切换 agent
- 默认 channel 处理轻量技术问答
- Codex agent 支持本地命令执行与会话复用
- 支持语音消息转写（ASR）
- 支持文本转语音（TTS，可选）
- 暴露 `/health` 健康检查接口

---

## 整体架构

```text
WeChat User
   ↓
OpenILink Bot
   ↓
OpenILink Hub
   ↓ WebSocket (multi-channel)
openilink-codex-bridge
   ├─ default-chat  → 默认轻量问答
   ├─ codex         → 本地代码执行 / 命令 / 改文件
   ├─ review        → 代码审查 / 风险分析
   └─ chat          → 技术讨论 / 方案咨询
```

bridge 本身不负责存储消息，而是负责：

1. 从 OpenILink Hub 接收消息事件
2. 识别消息落在哪个 channel，或是否带 `@agent` 前缀
3. 调度对应 agent 处理
4. 把结果通过 OpenILink send API 回发给原用户

---

## 路由规则

### 1) 按 channel 路由

推荐在 OpenILink 中建立多个 channel，例如：

- 默认 channel
- `@codex`
- `@review`
- `@chat`

bridge 会分别连接这些 channel 的 WebSocket key，并把消息交给对应 agent。

### 2) 按消息前缀路由

如果消息文本以以下前缀开头，也会切换目标 agent：

- `@codex`
- `@review`
- `@chat`

例如：

```text
@codex 帮我看看这个接口为什么 500
@review 帮我审一下这个 PR 的风险
@chat 给我讲讲这个架构怎么拆
```

---

## 目录结构

```text
src/                         # NestJS 源码
scripts/                     # 语音处理脚本（ASR / TTS）
dist/                        # 编译产物（构建后生成）
test/                        # e2e / 单测
.env.example                 # 环境变量示例
openilink-codex-bridge.service  # systemd service 样板
```

---

## 依赖要求

建议环境：

- Node.js 20+（当前部署环境使用 Node.js 24）
- npm
- 可访问本地 OpenILink Hub
- 如需语音功能：Python 3 + 独立虚拟环境

---

## 安装与启动

### 1. 安装依赖

```bash
npm install
```

### 2. 准备配置

```bash
cp .env.example .env
```

### 3. 构建

```bash
npm run build
```

### 4. 启动

开发模式：

```bash
npm run start:dev
```

生产模式：

```bash
npm run build
node dist/main.js
```

---

## 环境变量说明

项目通过 `.env` 配置运行，以下是最关键的几个字段。

### 基础配置

- `PORT`：bridge HTTP 监听端口，默认 `3000`
- `OPENILINK_HUB_BASE_URL`：OpenILink Hub 地址，默认 `http://127.0.0.1:9800`
- `CODEX_BIN`：Codex CLI 路径，默认 `codex`
- `CODEX_MODEL`：Codex 模型名
- `CODEX_WORKDIR`：Codex 执行工作目录

### Channel / WebSocket 配置

- `OPENILINK_KEY_DEFAULT`
- `OPENILINK_KEY_CODEX`
- `OPENILINK_KEY_REVIEW`
- `OPENILINK_KEY_CHAT`

这些 key 通常来自 OpenILink Hub 中对应 channel 的连接配置。

### 语音能力（可选）

- `ASR_PYTHON_BIN`
- `ASR_DECODE_SCRIPT`
- `ASR_WHISPER_BIN`
- `ASR_TRANSCRIBE_SCRIPT`
- `TTS_ENABLED`
- `TTS_PYTHON_BIN`
- `TTS_SCRIPT`

如果你不需要语音能力，可以先只保证文本链路跑通。

---

## 健康检查

服务启动后可通过：

```bash
curl http://127.0.0.1:3000/health
```

预期返回类似：

```json
{
  "ok": true,
  "service": "openilink-codex-bridge",
  "port": 3000
}
```

---

## 推荐部署方式

### 方式一：PM2（推荐）

适合长期常驻运行。

```bash
pm2 start dist/main.js \
  --name openilink-codex-bridge \
  --cwd /root/projects/openilink-codex-bridge \
  --interpreter node

pm2 save
```

常用命令：

```bash
pm2 list
pm2 logs openilink-codex-bridge
pm2 restart openilink-codex-bridge
pm2 stop openilink-codex-bridge
```

如果你已经配置好 `pm2 startup`，机器重启后也会自动恢复。

### 方式二：systemd

项目里提供了 `openilink-codex-bridge.service` 作为样板，可按实际路径调整后安装。

---

## 典型使用方式

### 默认问答

用户直接发消息：

```text
帮我解释一下这段日志是什么意思
```

默认由 `default-chat` 处理。

### 指定代码执行 agent

```text
@codex 帮我检查一下这个目录的报错
```

### 指定代码审查 agent

```text
@review 帮我看看这个实现有没有风险
```

### 指定技术讨论 agent

```text
@chat 给我一个重构方案
```

---

## 当前适用定位

这个 bridge 更适合：

- OpenILink 多 channel 本地桥接
- 面向微信侧的多 agent 协同
- 本地工具型 agent 接入（Codex / Review / Chat）

它不是一个通用 SaaS 网关，而是一个偏部署型、本地定制型的桥接层。

---

## 开发建议

如果你继续演进这个项目，比较值得优先补的方向有：

- 更完整的 `.env.example` 字段注释
- WebSocket 重连/异常恢复日志增强
- 更清晰的消息去重与 session 复用说明
- 更完整的部署文档（OpenILink Hub + channel key 获取）
- CI / lint / test 自动化

---

## 上游仓库

原始仓库：

<https://github.com/lxsisKing/openilink-codex-bridge>

当前仓库用于本机 bridge 部署与定制化维护。

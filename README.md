# openilink-codex-bridge

基于 OpenILink Hub 的本地 bridge 服务，用于把不同 channel 的消息分发到不同 agent（如 codex / review / chat），并通过 WebSocket 回传结果。

## 功能

- 连接多个 OpenILink channel WebSocket
- 按 `@codex` / `@review` / `@chat` 做路由
- 默认 channel 走轻量技术问答
- Codex agent 支持本地命令执行与会话复用
- 支持语音转写 / TTS（按环境变量启用）
- 暴露 `/health` 健康检查

## 目录

- `src/` 源码
- `dist/` 编译产物
- `scripts/` 语音相关脚本
- `.env.example` 环境变量示例
- `openilink-codex-bridge.service` systemd 样板

## 本地开发

```bash
npm install
cp .env.example .env
npm run build
npm run start
```

默认监听：`3000`

健康检查：

```bash
curl http://127.0.0.1:3000/health
```

## 生产运行

当前推荐通过 PM2 托管：

```bash
pm2 start dist/main.js --name openilink-codex-bridge --cwd /root/projects/openilink-codex-bridge --interpreter node
pm2 save
```

如需 systemd，可参考项目内 `openilink-codex-bridge.service`。

## 上游仓库

原始仓库：<https://github.com/lxsisKing/openilink-codex-bridge>

当前仓库用于本机 bridge 部署与定制化维护。

# Web 打包镜像

构建镜像：

```bash
docker build -t trace-ship/web-builder:node22 docker/package/web
```

在系统“打包镜像”中配置：

- 打包类型：`web`
- Docker 镜像：`trace-ship/web-builder:node22`
- 脚本入口：`/usr/local/bin/trace-ship-build`
- 默认构建目录：`.`
- 默认产物目录：`dist`

镜像会自动识别 `pnpm-lock.yaml`、`yarn.lock`、`package-lock.json`，执行对应的安装和 `build` 命令，并固定从 `dist` 目录复制产物到 `/workspace/artifacts`。

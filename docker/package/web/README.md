# Web 打包镜像

构建镜像：

```bash
./build.sh                # 构建默认镜像 trace-ship/web-builder:node22
./build.sh --export       # 构建并导出离线 tar 包(用于分发到内网打包机)
```

配置默认 npm 源（三种方式，优先级从低到高）：

1. Dockerfile 默认值：官方源 `https://registry.npmjs.org/`
2. 构建时指定：复制 `.env.example` 为 `.env` 修改 `NPM_REGISTRY`，或直接传环境变量
   `NPM_REGISTRY=http://127.0.0.1:28081/repository/npm-group/ ./build.sh`
3. 运行时覆盖：在系统打包配置的 `env_vars` 中设置 `NPM_CONFIG_REGISTRY`，
   无需重新构建镜像

入口脚本会将 `NPM_CONFIG_REGISTRY` 追加到项目 `.npmrc`（pnpm / yarn 不读取
`npm_config_*` 环境变量，必须走 `.npmrc`），追加位置在最后，优先级高于业务
项目 `.npmrc` 中已有的 registry 配置。

注意：地址指向宿主机服务（如 `127.0.0.1:28081` 的 Nexus）时，依赖系统打包
默认开启的 `--network host`；使用网卡 IP 或域名则无此限制。

在系统“打包镜像”中配置：

- 打包类型：`web`
- Docker 镜像：`trace-ship/web-builder:node22`
- 脚本入口：`/usr/local/bin/trace-ship-build`
- 默认构建目录：`.`
- 默认产物目录：`dist`

镜像会自动识别 `pnpm-lock.yaml`、`yarn.lock`、`package-lock.json`，执行对应的安装和 `build` 命令，并固定从 `dist` 目录复制产物到 `/workspace/artifacts`。

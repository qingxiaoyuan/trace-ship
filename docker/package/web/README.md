# Web 打包镜像（接入规范）

本目录是符合 Trace Ship 打包镜像规范的 Web 构建镜像示例。镜像可以推送到 Nexus 后在「打包镜像」中选择，也可以 `docker save` 导出 tar 包后在「打包镜像」页面直接导入本地。

## 构建与分发

```bash
./build.sh                          # 构建 trace-ship/web-builder:node22
./build.sh --export                 # 构建并导出离线 tar 包（用于页面上传导入）
docker tag trace-ship/web-builder:node22 <nexus-registry-host>/<docker-repo>/web-builder:node22
docker push <nexus-registry-host>/<docker-repo>/web-builder:node22
```

## 目录约定

平台运行时只挂载三个目录，`scripts` / `deploy` 使用镜像自身内容：

```
/workspace/
  source/        # 平台挂载：源码目录（工作目录）
  artifacts/     # 平台挂载：产物输出目录
  tmp/           # 平台挂载：临时目录
  scripts/       # 镜像提供：预制脚本，必须包含 pack.sh 打包入口
  deploy/        # 镜像提供：预制依赖（可选）
```

镜像必须满足：

- 提供 `/workspace/scripts/pack.sh`：内置打包入口脚本；
- 容器内存在 `/bin/sh`（平台统一以 `--entrypoint /bin/sh` 启动，镜像自身 ENTRYPOINT 不生效）。

## 执行逻辑

- 打包配置未填写自定义脚本：平台执行 `/workspace/scripts/pack.sh`；
- 打包配置填写了自定义脚本：平台在 `/workspace/source`（或 `BUILD_PATH` 指定目录）直接以 `sh -c` 执行该脚本，不经过 `pack.sh`；
- 两种模式都会注入相同的环境变量，产物需写入 `/workspace/artifacts`。

## 入口脚本职责（pack.sh）

1. 读取环境变量：`WORKSPACE`、`SOURCE_DIR`、`ARTIFACTS_DIR`、`SCRIPTS_DIR`、`DEPLOY_DIR`、`BUILD_PATH`、`OUTPUT_PATH`、`TAG_NAME`、`VERSION`、`PROJECT_CODE`；
2. 执行内置打包逻辑：`pnpm install` -> `pnpm run build`；
3. 将产物复制到 `/workspace/artifacts`；
4. 不主动从互联网拉取依赖（内网源由项目内 `.npmrc` 等配置处理）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `WORKSPACE` | 容器内工作区根目录，固定 `/workspace` |
| `SOURCE_DIR` | 源码目录，默认 `/workspace/source` |
| `ARTIFACTS_DIR` | 产物目录，默认 `/workspace/artifacts` |
| `SCRIPTS_DIR` | 脚本目录，默认 `/workspace/scripts` |
| `DEPLOY_DIR` | 预制依赖目录，默认 `/workspace/deploy`（可选） |
| `BUILD_PATH` | 源码内构建子目录，相对 `SOURCE_DIR` |
| `OUTPUT_PATH` | 产物输出子目录，相对 `BUILD_PATH` 对应目录 |
| `TAG_NAME` | Git Tag 名 |
| `VERSION` | 版本号 |
| `PROJECT_CODE` | 项目编码 |

## 示例 Dockerfile

```dockerfile
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y rsync git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/ /workspace/scripts/
RUN chmod +x /workspace/scripts/pack.sh \
    && mkdir -p /workspace/source /workspace/artifacts /workspace/tmp

WORKDIR /workspace/source
```

## 在系统中使用

1. 进入「打包镜像」页面，本地镜像可直接看到；远程镜像先在「系统配置」页面维护 Nexus 集成；
2. tar 包可通过「导入镜像」按钮导入本地；
3. 在「打包配置」中选择该镜像即可。

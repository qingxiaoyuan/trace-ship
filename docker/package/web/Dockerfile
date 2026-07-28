FROM node:22-bookworm-slim

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      git \
      rsync \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

# 镜像接入约定：/workspace/scripts 内置 pack.sh 打包入口；
# 平台运行时只挂载 /workspace/source、/workspace/artifacts、/workspace/tmp，
# scripts / deploy 目录使用镜像自身内容
COPY scripts/ /workspace/scripts/
RUN chmod +x /workspace/scripts/pack.sh \
    && mkdir -p /workspace/source /workspace/artifacts /workspace/tmp

# 可选：预置依赖目录（如 node_modules 缓存），按需向 /workspace/deploy 放置
# COPY deploy/ /workspace/deploy/

WORKDIR /workspace/source

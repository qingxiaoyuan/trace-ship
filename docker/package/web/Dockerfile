FROM node:22-bookworm-slim

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      git \
      rsync \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable
# npm 源地址：默认为官方源，构建时可用 --build-arg NPM_REGISTRY=... 定制，
# 运行时可用 -e NPM_CONFIG_REGISTRY=... 覆盖（系统打包配置的 env_vars 即走此方式）。
# 注意：地址指向宿主机服务（如 127.0.0.1:28081 的 Nexus）时，
# 运行此镜像需加 --network host 才能访问（系统打包已默认开启 host 网络）。
ARG NPM_REGISTRY="https://registry.npmjs.org/"
ENV NPM_CONFIG_REGISTRY="${NPM_REGISTRY}"

COPY trace-ship-build /usr/local/bin/trace-ship-build
RUN chmod +x /usr/local/bin/trace-ship-build

WORKDIR /workspace/source

ENTRYPOINT ["/usr/local/bin/trace-ship-build"]

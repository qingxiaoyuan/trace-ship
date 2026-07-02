FROM node:22-bookworm-slim

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      git \
      rsync \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

COPY trace-ship-build /usr/local/bin/trace-ship-build
RUN chmod +x /usr/local/bin/trace-ship-build

WORKDIR /workspace/source

ENTRYPOINT ["/usr/local/bin/trace-ship-build"]

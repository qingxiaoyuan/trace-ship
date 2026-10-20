# 本地与 GitHub Actions 共用同一 Python patch、系统库和后端开发依赖。
FROM python:3.11.17-slim-bookworm@sha256:0a310eeecf4e1f5a0743f9a6520c90c88d089c903ca5fd283f501e3a805f5f89

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DJANGO_SETTINGS_MODULE=config.settings.test

RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends build-essential libldap2-dev libsasl2-dev git \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt backend/requirements-dev.txt /opt/checks/
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN python -m pip install --no-cache-dir -r /opt/checks/requirements-dev.txt --index-url "$PIP_INDEX_URL"

WORKDIR /workspace/backend

#!/bin/sh
set -eu

# Trace Ship Web 打包入口脚本（镜像内置打包逻辑）
# 通用流程：pnpm install -> pnpm run build -> 收集产物（npm 源由项目 .npmrc 处理）
#
# 目录约定（/workspace/source、/workspace/artifacts、/workspace/tmp 由平台挂载；
# /workspace/scripts、/workspace/deploy 由镜像提供）：
#   /workspace/source       业务源码（工作目录）
#   /workspace/artifacts    产物输出
#   /workspace/scripts      预制脚本（含本入口 pack.sh）
#   /workspace/deploy       预制依赖（可选）
#
# 环境变量：
#   WORKSPACE             默认 /workspace
#   SOURCE_DIR            默认 $WORKSPACE/source
#   ARTIFACTS_DIR         默认 $WORKSPACE/artifacts
#   SCRIPTS_DIR           默认 $WORKSPACE/scripts
#   BUILD_PATH            源码内构建目录（相对 SOURCE_DIR）
#   OUTPUT_PATH           产物目录（相对 BUILD_PATH 对应目录）

log() {
  printf '[trace-ship-web] %s\n' "$*"
}

WORKSPACE="${WORKSPACE:-/workspace}"
SOURCE_DIR="${SOURCE_DIR:-$WORKSPACE/source}"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-$WORKSPACE/artifacts}"
BUILD_PATH="${BUILD_PATH:-.}"
OUTPUT_PATH="${OUTPUT_PATH:-dist}"

case "$BUILD_PATH" in
  ""|".") APP_DIR="$SOURCE_DIR" ;;
  /*) echo "BUILD_PATH must be relative" >&2; exit 2 ;;
  *..*) echo "BUILD_PATH must not contain .." >&2; exit 2 ;;
  *) APP_DIR="$SOURCE_DIR/$BUILD_PATH" ;;
esac

case "$OUTPUT_PATH" in
  ""|".") BUILD_OUTPUT_DIR="$APP_DIR" ;;
  /*) echo "OUTPUT_PATH must be relative" >&2; exit 2 ;;
  *..*) echo "OUTPUT_PATH must not contain .." >&2; exit 2 ;;
  *) BUILD_OUTPUT_DIR="$APP_DIR/$OUTPUT_PATH" ;;
esac

cd "$APP_DIR"

log "tag=${TAG_NAME:-}"
log "version=${VERSION:-}"
log "app_dir=$APP_DIR"
log "output_path=$OUTPUT_PATH"
log "artifacts_dir=$ARTIFACTS_DIR"

if [ ! -f package.json ]; then
  echo "package.json not found in $APP_DIR" >&2
  exit 2
fi

log "run pnpm install"
pnpm install

log "run pnpm build"
pnpm run build

if [ ! -d "$BUILD_OUTPUT_DIR" ]; then
  for candidate in dist build out; do
    if [ -d "$APP_DIR/$candidate" ]; then
      BUILD_OUTPUT_DIR="$APP_DIR/$candidate"
      break
    fi
  done
fi

if [ ! -d "$BUILD_OUTPUT_DIR" ]; then
  echo "build output directory not found: $BUILD_OUTPUT_DIR" >&2
  exit 3
fi

mkdir -p "$ARTIFACTS_DIR"
log "copy artifacts from $BUILD_OUTPUT_DIR to $ARTIFACTS_DIR"
rsync -a --delete "$BUILD_OUTPUT_DIR"/ "$ARTIFACTS_DIR"/

log "done"

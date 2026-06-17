#!/bin/bash
# 第三方服务一键重启脚本
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

./stop.sh
./start.sh

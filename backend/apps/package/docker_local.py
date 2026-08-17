"""
本地 Docker 镜像浏览服务

通过宿主机 docker CLI（docker images）列出本机可用的镜像，
供打包镜像页面与打包配置直接选择使用。
"""
import json
import shutil
import subprocess
from typing import Any

from utils.probe_output import parse_probe_output


class LocalDockerError(RuntimeError):
    """本地 Docker 不可用或执行异常。"""


class LocalDockerService:
    """本机 Docker 镜像列表服务。"""

    @classmethod
    def load_image(cls, tar_path: str) -> list[str]:
        """
        从 tar 包导入镜像到本地 Docker（docker load）。

        返回导入成功的镜像地址列表（解析 "Loaded image: ..." 输出）。
        """
        if not shutil.which("docker"):
            raise LocalDockerError("当前环境未安装 docker CLI，无法导入镜像")
        try:
            result = subprocess.run(
                ["docker", "load", "-i", tar_path],
                capture_output=True,
                text=True,
                timeout=600,
            )
        except subprocess.TimeoutExpired as exc:
            raise LocalDockerError("导入镜像超时（超过 10 分钟）") from exc
        except OSError as exc:
            raise LocalDockerError(f"无法执行 docker 命令：{exc}") from exc
        output = f"{result.stdout}\n{result.stderr}"
        if result.returncode != 0:
            detail = output.strip().splitlines()
            raise LocalDockerError(f"导入镜像失败：{detail[-1] if detail else '未知错误'}")
        loaded: list[str] = []
        for line in output.splitlines():
            line = line.strip()
            if line.startswith("Loaded image:"):
                image = line.removeprefix("Loaded image:").strip()
                if image:
                    loaded.append(image)
        return loaded

    @classmethod
    def list_images(cls, keyword: str = "") -> list[dict[str, Any]]:
        """
        列出本地 Docker 镜像。

        返回结构：[{source, image, name, version, repository, registry_host, image_id, size}]
        其中 name 为完整镜像名（可能含 registry 前缀路径），image 为 name:tag。
        悬空镜像（<none>）会被过滤。
        """
        if not shutil.which("docker"):
            raise LocalDockerError("当前环境未安装 docker CLI，无法读取本地镜像")
        try:
            result = subprocess.run(
                ["docker", "images", "--format", "{{json .}}"],
                capture_output=True,
                text=True,
                timeout=15,
            )
        except subprocess.TimeoutExpired as exc:
            raise LocalDockerError("读取本地 Docker 镜像超时") from exc
        except OSError as exc:
            raise LocalDockerError(f"无法执行 docker 命令：{exc}") from exc
        if result.returncode != 0:
            detail = (result.stderr or "").strip()
            raise LocalDockerError(f"读取本地 Docker 镜像失败：{detail or '未知错误'}")

        kw = keyword.strip().lower()
        items: list[dict[str, Any]] = []
        seen: set[str] = set()
        for line in result.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
            except ValueError:
                continue
            name = raw.get("Repository") or ""
            tag = raw.get("Tag") or ""
            if not name or not tag or name == "<none>" or tag == "<none>":
                continue
            image = f"{name}:{tag}"
            if image in seen:
                continue
            if kw and kw not in image.lower():
                continue
            seen.add(image)
            items.append(
                {
                    "source": "local",
                    "image": image,
                    "name": name,
                    "version": tag,
                    "repository": "",
                    "registry_host": "",
                    "image_id": (raw.get("ID") or "")[:12],
                    "size": raw.get("Size") or "",
                }
            )
        items.sort(key=lambda item: item["image"])
        return items

    @classmethod
    def probe_image(cls, image: str, timeout: int = 45) -> tuple[dict[str, Any] | None, str | None]:
        """
        对本地镜像执行固定只读探测（docker run --rm --entrypoint /bin/sh）。

        探测内容：常用工具链版本、/workspace/scripts 与 /workspace/deploy 文件列表、
        pack.sh 前 4KB、pwd 与 PATH。不输出镜像完整 env，避免镜像内嵌密钥进入 prompt。
        使用 --pull=never：镜像必须已在本机加载（与打包执行一致），缺失立即失败并给出
        可读原因，不尝试拉取；探测失败不抛异常，返回 (None, 原因) 供调用方降级。

        Args:
            image: 本地镜像地址（name:tag）
            timeout: 探测超时秒数

        Returns:
            (解析后的 dict, None) 成功；(None, 失败原因) 失败
        """
        if not shutil.which("docker"):
            return None, "当前环境未安装 docker CLI，无法探测镜像"
        try:
            result = subprocess.run(
                [
                    "docker", "run", "--rm", "--pull=never", "--entrypoint", "/bin/sh",
                    image, "-ec", IMAGE_PROBE_SH,
                ],
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            return None, f"镜像探测超时（超过 {timeout} 秒）"
        except OSError as exc:
            return None, f"无法执行 docker 命令：{exc}"
        if result.returncode != 0:
            return None, cls._extract_probe_error(
                image, f"{result.stdout}\n{result.stderr}"
            )
        return parse_probe_output(result.stdout), None

    @staticmethod
    def _extract_probe_error(image: str, output: str) -> str:
        """从 docker 报错中提取真实原因，过滤掉 CLI 的帮助提示行。"""
        lines = [line.strip() for line in output.splitlines() if line.strip()]
        meaningful = [
            line
            for line in lines
            if "run --help" not in line and "See 'docker" not in line
        ]
        if not meaningful:
            return f"镜像探测失败：{lines[-1] if lines else '未知错误'}"
        for line in meaningful:
            lowered = line.lower()
            if any(
                keyword in lowered
                for keyword in (
                    "no such image",
                    "pull access denied",
                    "pull denied",
                    "image not found",
                )
            ):
                return (
                    f"镜像未在本机加载：{image}"
                    "（探测不会尝试拉取，请先导入或构建该镜像）"
                )
        error = next(
            (
                line
                for line in meaningful
                if line.startswith("Error response from daemon")
                or line.startswith("docker:")
            ),
            meaningful[0],
        )
        return f"镜像探测失败：{error}"


# 容器内只读探测脚本：只输出工具链版本与约定目录信息，不输出镜像完整 env
# （避免镜像内嵌密钥进入 AI prompt）。由平台硬编码执行，不包含用户/AI 内容。
IMAGE_PROBE_SH = r"""
echo '--- versions ---'
for c in node npm pnpm yarn npx python3 python python2 pip3 pip java mvn gradle dotnet go gcc g++ make cmake ruby bundle php composer; do
  if command -v "$c" >/dev/null 2>&1; then
    printf '%s: ' "$c"
    "$c" --version 2>&1 | head -n 1
  fi
done
echo '--- workspace scripts ---'
ls -la /workspace/scripts 2>/dev/null || echo '(missing)'
echo '--- pack.sh ---'
head -c 4096 /workspace/scripts/pack.sh 2>/dev/null || echo '(missing)'
echo '--- workspace deploy ---'
ls -la /workspace/deploy 2>/dev/null || echo '(missing)'
echo '--- pwd ---'
pwd
echo '--- path ---'
printf '%s' "$PATH"
""".strip()

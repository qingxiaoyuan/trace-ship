"""
本地 Docker 镜像浏览服务

通过宿主机 docker CLI（docker images）列出本机可用的镜像，
供打包镜像页面与打包配置直接选择使用。
"""
import json
import shutil
import subprocess
from typing import Any


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

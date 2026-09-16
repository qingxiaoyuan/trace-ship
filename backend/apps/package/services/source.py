"""
源码拉取与构建环境变量
"""
import base64
import shutil
from pathlib import Path

from utils.markdown_table import table_newlines_to_br
from utils.provider.credential_resolver import resolve_credential


class SourceCheckoutMixin:
    """本地源码克隆与构建环境变量组装。"""

    @classmethod
    def _checkout_source(cls, task, workspace: Path) -> None:
        """克隆仓库并 checkout 到发布 tag。

        配置开启 clone_submodules 时递归拉取子模块（子模块完整克隆，不浅化，
        便于构建脚本在子模块内提交并 push）；主仓库保持 --depth 1 浅克隆。
        """
        source_dir = workspace / "source"
        if any(source_dir.iterdir()):
            shutil.rmtree(source_dir)
            source_dir.mkdir(parents=True, exist_ok=True)
        snapshot = task.config_snapshot or {}
        clone_url = cls._clone_url(task.repository)
        env = cls._build_auth_env(task.repository, task.triggered_by, product=task.project)
        clone_cmd = ["git", "clone", "--depth", "1", "--branch", task.tag_name]
        if snapshot.get("clone_submodules"):
            clone_cmd.append("--recurse-submodules")
        clone_cmd.extend([clone_url, str(source_dir)])
        cls._run_command(task, clone_cmd, workspace, env)
        # 写入本次发布说明到源码根目录，供构建脚本读取（分支直打包无发布说明，跳过）
        if task.release_id:
            doc_path = source_dir / f"release-{cls._doc_filename(task.version)}.md"
            doc_path.write_text(table_newlines_to_br(task.release.release_doc or ""), encoding="utf-8")
            cls._append_log(task, f"已将发布说明写入源码根目录: {doc_path}")
        else:
            cls._append_log(task, "分支直打包：无发布说明，跳过写入")

    @staticmethod
    def _auth_clone_args(repo, request_user=None, product=None) -> list[str]:
        """生成 git 认证参数（http.extraHeader Basic 头）。

        不把凭证编进克隆 URL：URL 编码产生的 %XX 会被 cmd 的 %var% 展开破坏，
        且会触发 wincredman 持久化报错。base64 字符集（A-Za-z0-9+/=）对 cmd 安全，
        也不会出现在报错回显中。
        """
        data = resolve_credential(repo, request_user, product=product)
        username = data.get("username") or ""
        token = data.get("token") or data.get("password") or ""
        if not token:
            return []
        if not username:
            username = "oauth2"
        raw = base64.b64encode(f"{username}:{token}".encode()).decode("ascii")
        return ["-c", f"http.extraHeader=Authorization: Basic {raw}"]

    @classmethod
    def _build_env(cls, task, workspace) -> dict[str, str]:
        """构建打包执行环境变量（workspace 可为本地 Path 或远程 PureWindowsPath）。

        仅发布触发的任务才注入 RELEASE_DOC_PATH：发布说明文件随源码写入源码根目录，
        构建脚本可读取该文件；分支直打包任务无发布说明、文件不存在，因此不注入该变量，
        避免构建脚本误读不存在的文件路径。
        """
        snapshot = task.config_snapshot or {}
        env_vars = snapshot.get("env_vars") if isinstance(snapshot.get("env_vars"), dict) else {}
        env = {
            **{str(k): str(v) for k, v in env_vars.items()},
            "TAG_NAME": task.tag_name,
            "VERSION": task.version,
            "BUILD_PATH": cls._safe_rel_path(snapshot.get("build_path", "."), "."),
            "OUTPUT_PATH": cls._safe_rel_path(snapshot.get("output_path", "artifacts"), "artifacts"),
            "PROJECT_CODE": task.project.code or task.project.name,
            "WORKSPACE": str(workspace),
            "SOURCE_DIR": str(workspace / "source"),
            "ARTIFACTS_DIR": str(workspace / "artifacts"),
            "DEPLOY_DIR": str(workspace / "deploy"),
            "SCRIPTS_DIR": str(workspace / "scripts"),
            "TMPDIR": str(workspace / "tmp"),
        }
        if task.release_id:
            env["RELEASE_DOC_PATH"] = str(workspace / "source" / f"release-{cls._doc_filename(task.version)}.md")
        return env

    @classmethod
    def _task_env(cls, task, workspace: Path) -> dict[str, str]:
        """构建打包执行环境变量。"""
        return cls._build_env(task, workspace)

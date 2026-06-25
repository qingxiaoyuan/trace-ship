"""
Jenkins Provider

基于 python-jenkins 库封装 Jenkins 的连通性探测、构建触发、状态查询、日志与产物获取。
"""
from typing import Any, Dict, List, Optional

import jenkins

from .exceptions import AuthenticationError, ConnectionError, ProviderError


class JenkinsProvider:
    """
    Jenkins 适配器

    使用 python-jenkins 与 Jenkins 服务器交互，统一封装构建触发与查询能力。
    """

    def __init__(self, server_url: str, credential_data: dict):
        """
        Args:
            server_url: Jenkins 服务器地址
            credential_data: 解密后的凭证数据，支持 {"username": "", "token": ""} 或 {"token": ""}
        """
        self.server_url = server_url.rstrip("/")
        self.credential_data = credential_data
        self._server: Optional[jenkins.Jenkins] = None

    def _get_server(self) -> jenkins.Jenkins:
        """
        延迟创建并返回 python-jenkins 客户端

        Returns:
            Jenkins 客户端实例
        """
        if self._server is None:
            username = self.credential_data.get("username", "")
            password = (
                self.credential_data.get("token")
                or self.credential_data.get("password", "")
            )
            # 若未提供用户名，则使用 token 作为用户名（API Token 常见用法）
            if not username and password:
                username = password
            try:
                self._server = jenkins.Jenkins(self.server_url, username=username, password=password)
            except jenkins.JenkinsException as exc:
                raise ConnectionError(f"Jenkins 连接失败: {exc}") from exc
        return self._server

    def test_connection(self) -> bool:
        """
        测试 Jenkins 连通性

        Returns:
            是否连通

        Raises:
            ConnectionError: 连接失败
            AuthenticationError: 认证失败
        """
        try:
            server = self._get_server()
            server.get_whoami()
            return True
        except jenkins.BadHTTPException as exc:
            raise AuthenticationError(f"Jenkins 认证失败: {exc}") from exc
        except jenkins.JenkinsException as exc:
            raise ConnectionError(f"Jenkins 连接失败: {exc}") from exc

    def trigger_build(self, job_name: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        触发 Jenkins 构建

        Args:
            job_name: Jenkins Job 名
            params: 构建参数字典

        Returns:
            {"queue_id": int} 字典

        Raises:
            ProviderError: 触发失败
        """
        server = self._get_server()
        params = params or {}
        try:
            queue_id = server.build_job(job_name, params)
        except jenkins.JenkinsException as exc:
            raise ProviderError(f"触发 Jenkins 构建失败: {exc}") from exc
        return {"queue_id": queue_id}

    def get_build_number(self, job_name: str, queue_id: str) -> Optional[int]:
        """
        根据队列号获取构建号

        Args:
            job_name: Jenkins Job 名
            queue_id: 队列号

        Returns:
            构建号或 None（尚未分配）
        """
        server = self._get_server()
        try:
            queue_item = server.get_queue_item(int(queue_id))
        except (jenkins.JenkinsException, ValueError):
            return None

        # queue_item 中存在 executable 即表示已分配到构建号
        executable = queue_item.get("executable")
        if executable:
            return int(executable.get("number", 0))
        # 队列项已取消或无效
        if queue_item.get("cancelled"):
            return -1
        return None

    def get_build_info(self, job_name: str, build_number: int) -> Dict[str, Any]:
        """
        获取构建详情

        Args:
            job_name: Jenkins Job 名
            build_number: 构建号

        Returns:
            标准化后的构建信息字典
        """
        server = self._get_server()
        try:
            info = server.get_build_info(job_name, build_number)
        except jenkins.JenkinsException as exc:
            raise ProviderError(f"获取 Jenkins 构建信息失败: {exc}") from exc

        result = info.get("result")
        if result == "SUCCESS":
            status = "success"
        elif result == "FAILURE":
            status = "failure"
        elif result == "ABORTED":
            status = "aborted"
        else:
            status = "running"

        artifacts = []
        for artifact in info.get("artifacts", []):
            relative_path = artifact.get("relativePath", "")
            artifacts.append({
                "file_name": artifact.get("fileName", ""),
                "url": f"{info.get('url')}artifact/{relative_path}",
            })

        return {
            "build_number": build_number,
            "status": status,
            "url": info.get("url", ""),
            "duration": info.get("duration", 0),
            "artifacts": artifacts,
        }

    def get_build_log(self, job_name: str, build_number: int) -> str:
        """
        获取构建日志

        Args:
            job_name: Jenkins Job 名
            build_number: 构建号

        Returns:
            日志文本
        """
        server = self._get_server()
        try:
            return server.get_build_console_output(job_name, build_number)
        except jenkins.JenkinsException as exc:
            raise ProviderError(f"获取 Jenkins 构建日志失败: {exc}") from exc

    def get_build_artifacts(self, job_name: str, build_number: int) -> List[Dict[str, Any]]:
        """
        获取构建产物列表

        Args:
            job_name: Jenkins Job 名
            build_number: 构建号

        Returns:
            产物信息列表
        """
        info = self.get_build_info(job_name, build_number)
        return info.get("artifacts", [])

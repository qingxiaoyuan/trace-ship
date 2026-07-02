"""
Jenkins Provider

基于 python-jenkins 库封装 Jenkins 的连通性探测、Job 管理、构建触发、状态查询、日志与产物获取。
"""
import json
from typing import Any, Dict, List, Optional
from xml.sax.saxutils import escape

import jenkins
import requests

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
            username, password = self._get_auth_pair()
            try:
                self._server = jenkins.Jenkins(self.server_url, username=username, password=password)
            except jenkins.JenkinsException as exc:
                raise ConnectionError(f"Jenkins 连接失败: {exc}") from exc
        return self._server

    def _get_auth_pair(self) -> tuple[str, str]:
        """返回 Jenkins 用户名和 API Token / 密码。"""
        username = self.credential_data.get("username", "")
        password = self.credential_data.get("token") or self.credential_data.get("password", "")
        # 若未提供用户名，则使用 token 作为用户名（兼容历史 token-only 凭证）
        if not username and password:
            username = password
        return username, password

    def _request_session(self) -> requests.Session:
        """创建带 Jenkins 鉴权与 crumb 的 requests Session。"""
        username, password = self._get_auth_pair()
        session = requests.Session()
        session.auth = (username, password)
        try:
            resp = session.get(f"{self.server_url}/crumbIssuer/api/json", timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                session.headers.update({data["crumbRequestField"]: data["crumb"]})
        except requests.RequestException:
            # 部分 Jenkins 关闭 crumb issuer，后续请求自行返回真实错误
            pass
        return session

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

    def job_exists(self, job_name: str) -> bool:
        """
        判断 Jenkins Job 是否存在。

        Args:
            job_name: Jenkins Job 名

        Returns:
            是否存在
        """
        server = self._get_server()
        try:
            return bool(server.job_exists(job_name))
        except jenkins.JenkinsException as exc:
            raise ProviderError(f"检查 Jenkins Job 失败: {exc}") from exc

    def create_or_update_pipeline_job(self, job_name: str, pipeline_script: str) -> None:
        """
        创建或更新 Pipeline Job。

        Args:
            job_name: Jenkins Job 名
            pipeline_script: Pipeline Groovy 脚本
        """
        server = self._get_server()
        config_xml = self._build_pipeline_config_xml(pipeline_script)
        try:
            if server.job_exists(job_name):
                server.reconfig_job(job_name, config_xml)
            else:
                server.create_job(job_name, config_xml)
        except jenkins.JenkinsException as exc:
            raise ProviderError(f"创建或更新 Jenkins Pipeline Job 失败: {exc}") from exc

    def create_or_update_username_password_credential(
        self,
        credential_id: str,
        username: str,
        password: str,
        description: str = "",
    ) -> None:
        """
        创建或覆盖 Jenkins 系统域用户名密码凭据。

        Args:
            credential_id: Jenkins 凭据 ID
            username: 用户名
            password: 密码或 Token
            description: 描述
        """
        if not username or not password:
            raise ProviderError("同步 Jenkins Git 凭据失败: 用户名或密码为空")

        session = self._request_session()
        base = f"{self.server_url}/credentials/store/system/domain/_"
        # Jenkins credentials API 对重复 ID 返回 400；这里先删除再创建，保证配置可更新。
        try:
            session.post(f"{base}/credential/{credential_id}/doDelete", timeout=15)
            payload = {
                "": "0",
                "credentials": {
                    "scope": "GLOBAL",
                    "id": credential_id,
                    "username": username,
                    "password": password,
                    "description": description,
                    "$class": "com.cloudbees.plugins.credentials.impl.UsernamePasswordCredentialsImpl",
                },
            }
            resp = session.post(
                f"{base}/createCredentials",
                data={"json": json.dumps(payload)},
                timeout=30,
            )
        except requests.RequestException as exc:
            raise ProviderError(f"同步 Jenkins Git 凭据失败: {exc}") from exc

        if resp.status_code not in (200, 302):
            raise ProviderError(f"同步 Jenkins Git 凭据失败: HTTP {resp.status_code} {resp.text[:200]}")

    @staticmethod
    def _build_pipeline_config_xml(pipeline_script: str) -> str:
        """构建 Pipeline Job config.xml。"""
        script = escape(pipeline_script)
        return f"""<?xml version='1.1' encoding='UTF-8'?>
<flow-definition plugin="workflow-job">
  <description>Trace Ship 托管打包任务</description>
  <keepDependencies>false</keepDependencies>
  <properties>
    <hudson.model.ParametersDefinitionProperty>
      <parameterDefinitions>
        <hudson.model.StringParameterDefinition>
          <name>TAG_NAME</name>
          <description>需要打包的 Git Tag</description>
          <defaultValue></defaultValue>
          <trim>true</trim>
        </hudson.model.StringParameterDefinition>
      </parameterDefinitions>
    </hudson.model.ParametersDefinitionProperty>
  </properties>
  <definition class="org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition" plugin="workflow-cps">
    <script>{script}</script>
    <sandbox>true</sandbox>
  </definition>
  <triggers/>
  <disabled>false</disabled>
</flow-definition>"""

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
            "estimated_duration": info.get("estimatedDuration", 0),
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

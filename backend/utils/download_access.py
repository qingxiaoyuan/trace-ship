"""下载网段与可信代理链路校验。"""

import json
import os
import re
import socket
import subprocess
from ipaddress import IPv4Address, IPv4Network, IPv6Address, IPv6Network, ip_address, ip_network

from django.conf import settings
from rest_framework.request import Request

from apps.system.services import DownloadPolicyConfig

DOWNLOAD_DENIED_MESSAGE = "当前网络不允许下载，请连接允许下载的内网后重试"
Address = IPv4Address | IPv6Address
Network = IPv4Network | IPv6Network
_CONTAINER_NETWORK_FORMAT = (
    '[{{json .State.Running}},'
    '{{json (index .Config.Labels "com.docker.compose.project")}},'
    '{{json (index .Config.Labels "com.docker.compose.service")}},'
    '{{json .NetworkSettings.Networks}}]'
)


def parse_cidrs(value: str) -> tuple[Network, ...]:
    """接受换行、空白或逗号分隔的 IP 和网段。"""
    networks: list[Network] = []
    for item in filter(None, re.split(r"[\s,]+", value.strip())):
        if "%" in item:
            raise ValueError("网段不允许携带作用域")
        network = ip_network(item)
        if isinstance(network, IPv6Network) and network.prefixlen >= 96:
            mapped = network.network_address.ipv4_mapped
            if mapped is not None:
                network = IPv4Network((mapped, network.prefixlen - 96))
        networks.append(network)
    return tuple(networks)


def _parse_ip(value: str) -> Address:
    address = ip_address(value.strip())
    if isinstance(address, IPv6Address):
        if address.scope_id:
            raise ValueError("请求来源 IP 不允许携带作用域")
        return address.ipv4_mapped or address
    return address


def _frontend_proxy_addresses() -> set[Address]:
    """从已有 Docker socket 核验同一 Compose 应用内前端的当前地址。"""
    project = os.getenv("COMPOSE_PROJECT_NAME") or "trace-ship"
    try:
        output = subprocess.run(
            ["docker", "--host", "unix:///var/run/docker.sock", "inspect", "--type", "container",
             "--format", _CONTAINER_NETWORK_FORMAT, "--", socket.gethostname(), f"{project}-frontend"],
            capture_output=True, text=True, timeout=2, check=True,
        ).stdout
        backend, frontend = (json.loads(line) for line in output.splitlines())
        backend_running, backend_project, backend_service, backend_networks = backend
        frontend_running, frontend_project, frontend_service, frontend_networks = frontend
        if (
            not backend_running or not frontend_running or not backend_project
            or frontend_project != backend_project or backend_service != "backend" or frontend_service != "frontend"
        ):
            return set()
        shared_ids = {network["NetworkID"] for network in backend_networks.values() if network["NetworkID"]}
        return {
            _parse_ip(network[field])
            for network in frontend_networks.values()
            if network["NetworkID"] in shared_ids
            for field in ("IPAddress", "GlobalIPv6Address")
            if network.get(field)
        }
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError, AttributeError):
        return set()


def _client_ip(request: Request, trusted_proxies: str) -> Address | None:
    trusted = parse_cidrs(trusted_proxies)
    frontend = _frontend_proxy_addresses() if settings.DOWNLOAD_DISCOVER_FRONTEND_PROXY else set()
    if settings.DOWNLOAD_DISCOVER_FRONTEND_PROXY and not frontend:
        # 无法确认前端身份时，不把可能是代理的对端地址当成客户端地址。
        return None

    def is_trusted(address: Address) -> bool:
        return address in frontend or any(address in network for network in trusted)

    address = _parse_ip(request.META.get("REMOTE_ADDR", ""))
    if not is_trusted(address):
        return address

    # 可信代理链应只留下一个客户端地址。还有前置地址时，可能存在未登记的代理。
    for hop in reversed(request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")):
        if not is_trusted(address):
            return None
        address = _parse_ip(hop)
    return None if is_trusted(address) else address


def _matches_network(request: Request, value: str, trusted_proxies: str) -> bool:
    try:
        networks = parse_cidrs(value)
        address = _client_ip(request, trusted_proxies) if networks else None
        return address is not None and any(address in network for network in networks)
    except ValueError:
        return False


def can_download_files(request: Request) -> bool:
    value, trusted_proxies = DownloadPolicyConfig.get()
    return value is None or _matches_network(request, value, trusted_proxies)


def can_manage_download_policy(request: Request, trusted_proxies: str) -> bool:
    value = settings.DOWNLOAD_POLICY_ADMIN_CIDRS
    return value is None or _matches_network(request, value, trusted_proxies)

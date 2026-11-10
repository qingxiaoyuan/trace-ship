"""下载网段与可信代理链路校验。"""

import re
from ipaddress import IPv4Address, IPv4Network, IPv6Address, IPv6Network, ip_address, ip_network

from django.conf import settings
from rest_framework.request import Request

from apps.system.services import DownloadPolicyConfig

DOWNLOAD_DENIED_MESSAGE = "当前网络不允许下载，请连接允许下载的内网后重试"
Address = IPv4Address | IPv6Address
Network = IPv4Network | IPv6Network


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


def _client_ip(request: Request) -> Address | None:
    trusted = parse_cidrs(settings.DOWNLOAD_TRUSTED_PROXY_CIDRS)
    address = _parse_ip(request.META.get("REMOTE_ADDR", ""))
    # 仅剥离从服务端向客户端连续出现的可信代理，忽略客户端自行附加的前缀。
    for hop in reversed(request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")):
        if not any(address in network for network in trusted):
            return address
        address = _parse_ip(hop)
    return address if not any(address in network for network in trusted) else None


def _matches_network(request: Request, value: str) -> bool:
    try:
        networks = parse_cidrs(value)
        address = _client_ip(request) if networks else None
        return address is not None and any(address in network for network in networks)
    except ValueError:
        return False


def can_download_files(request: Request) -> bool:
    value = DownloadPolicyConfig.get()
    return value is None or _matches_network(request, value)


def can_manage_download_policy(request: Request) -> bool:
    return _matches_network(request, settings.DOWNLOAD_POLICY_ADMIN_CIDRS)

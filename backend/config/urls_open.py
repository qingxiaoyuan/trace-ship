"""
对外开放接口路由

统一挂在 /api/open/ 前缀下，与内部 /api/ 区分。
所有开放接口均为只读（GET），使用 Access Token 认证 + scope 授权：
- authentication_classes = [AccessTokenAuthentication]
- permission_classes = [HasAccessTokenScope]
- 视图声明 open_scope（OPEN_API_SCOPES 中的编码）

新增开放接口时：在 OPEN_API_SCOPES（apps/system/models.py）登记 scope 编码，
再在此注册路由。
"""
from django.urls import path

from apps.release.views_open import OpenReleaseDocView
from apps.repository.views_open import OpenTagCompareView

urlpatterns = [
    # 按 tag 查询发布变更文档（scope: release.doc）
    path("release-doc/", OpenReleaseDocView.as_view(), name="open-release-doc"),
    # 查询两个 tag 之间的 commits 与 MRs（scope: repo.compare）
    path("compare/", OpenTagCompareView.as_view(), name="open-tag-compare"),
]

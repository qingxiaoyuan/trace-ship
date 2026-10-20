"""标准测试配置必须真正执行 Celery eager，不因无效后端悄悄走本地线程。"""

from unittest.mock import patch

import pytest

from apps.account.models import User
from apps.package.models import PackageTask
from apps.package.services import PackageService
from apps.package.tasks import run_package_task
from apps.project.models import Project
from apps.repository.models import Repository


@pytest.mark.django_db
def test_real_celery_eager_returns_task_result_without_local_worker_fallback() -> None:
    """公开任务返回真实结果，服务投递已结束任务也不启动外部构建或本地线程。"""
    user = User.objects.create_user(username="eager_dispatch", password="isolated")
    project = Project.objects.create(name="内存投递验证项目", code="EAGER", leader=user)
    repository = Repository.objects.create(
        name="内存投递验证仓库", repo_type="git", vendor="gitlab",
        url="https://example.invalid/eager.git", created_by=user,
    )
    task = PackageTask.objects.create(
        project=project, repository=repository, triggered_by=user,
        name="已结束任务不得再次执行", status="success",
    )

    result = run_package_task.delay(str(task.id))

    assert result.get(timeout=5) == {"status": "success"}
    with patch.object(PackageService, "_start_local_worker", side_effect=AssertionError("标准测试配置不应回退本地线程")):
        PackageService.dispatch_task(task)
    task.refresh_from_db()
    assert task.status == "success"
    assert task.workspace_path == ""

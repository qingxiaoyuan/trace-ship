"""隔离浏览器使用的固定 AI 报告与代码差异，不调用外部模型或 Git 服务。"""

import difflib
import uuid


def create_review_sample(project, repository, owner) -> dict:
    """保存虚构的审查快照，通过真实 HTTP 接口读取与采纳。"""
    from apps.release.models import ReleaseRecord, ReleaseReviewScope
    from apps.system.models import SystemConfig
    from apps.system.review_settings import save_settings
    from apps.workflow.ai_review_policy import diff_exclusion
    from apps.workflow.models import (
        AIReviewRemediation,
        AIReviewRun,
        WorkflowDefinition,
        WorkflowInstance,
        WorkflowTask,
    )

    nodes = [
        {"node_id": "ai", "node_name": "代码质量审查", "node_type": "ai_review"},
        {"node_id": "human", "node_name": "人工复核", "mode": "any",
         "approvers": [{"type": "user", "user_id": str(owner.id)}]},
    ]
    definition = WorkflowDefinition.objects.create(
        project=project, repository=repository, name="隔离 AI 评论验收", release_type="rc", node_config=nodes,
    )
    release = ReleaseRecord.objects.create(
        project=project, repository=repository, publisher=owner, release_type="rc", status="pending",
        version="VA.74.0.1-rc", tag_name="VA.74.0.1-rc_smoke", branch="main", git_hash="b" * 40,
        release_doc="# 审查界面验收\n\n固定差异与意见均为虚构样本。",
    )
    instance = WorkflowInstance.objects.create(
        definition=definition, biz_type="release", biz_id=str(release.id), source_project=project,
        created_by=owner, status="running", current_node_id="human", node_config_snapshot=nodes,
    )
    release.workflow_instance = instance
    release.save(update_fields=["workflow_instance"])
    WorkflowTask.objects.create(instance=instance, node_id="human", node_name="人工复核", approver=owner)
    before = [
        'import { useState } from "react";', '', 'export function UserDirectory({ initialUsers }) {',
        '  const [users, setUsers] = useState(initialUsers);', '',
        '  function removeUser(id) {', '    setUsers(users.filter(user => user.id !== id));', '  }', '',
        '  return users.map(user => (', '    <article key={user.id}>',
        '      <p>{user.bio}</p>', '      <button onClick={() => removeUser(user.id)}>删除</button>',
        '    </article>', '  ));', '}',
    ]
    after = before.copy()
    after[6] = '    users.splice(users.findIndex(user => user.id === id), 1);'
    after.insert(7, '    setUsers(users);')
    after[12] = '      <p dangerouslySetInnerHTML={{ __html: user.bio }} />'
    after[13] = '      <button onClick={removeUser(user.id)}>删除</button>'
    prefix = [f'// 固定上下文 {index}' for index in range(240)]
    diff = '\n'.join(list(difflib.unified_diff(prefix + before, prefix + after, n=300, lineterm=''))[2:])
    paths = ['src/review-samples/UserDirectory.jsx', 'src/review-samples/permissions.ts', 'src/review-samples/renamed.ts']
    findings = [
        {"id": str(uuid.uuid4()), "severity": "P0", "title": "用户简介直接渲染 HTML，存在存储型 XSS",
         "reason": "`user.bio` 来自接口，未经净化就写入 HTML。保存的用户简介可能在其他用户打开页面时执行脚本。",
         "suggestion": "使用文本插值 `{user.bio}`；确需富文本时先按可信白名单净化。",
         "path": paths[0], "side": "new", "line_start": 13, "line_end": 13},
        {"id": str(uuid.uuid4()), "severity": "P1", "title": "删除逻辑直接修改 state 数组",
         "reason": "`splice` 修改原数组，`setUsers(users)` 继续传入同一引用；列表可能不重新渲染。未找到用户时还会删除最后一项。",
         "suggestion": "使用 `setUsers(current => current.filter(user => user.id !== id))` 创建新数组。",
         "path": paths[0], "side": "new", "line_start": 7, "line_end": 8},
        {"id": str(uuid.uuid4()), "severity": "P1", "title": "渲染期间立即执行删除函数",
         "reason": "`onClick={removeUser(user.id)}` 在渲染时立即调用函数，按钮无法等待用户点击。",
         "suggestion": "改为 `onClick={() => removeUser(user.id)}`。",
         "path": paths[0], "side": "new", "line_start": 14, "line_end": 14},
        {"id": str(uuid.uuid4()), "severity": "P1", "title": "删除操作缺少权限校验",
         "reason": "所有用户都可以执行删除操作。", "suggestion": "调用前校验操作权限，服务端也应验证。",
         "path": paths[1], "side": "new", "line_start": 1, "line_end": 1},
        {"id": str(uuid.uuid4()), "severity": "P2", "title": "缺少删除失败的反馈",
         "reason": "当前变更没有定义请求失败时的用户反馈。", "suggestion": "补充错误处理和页面提示。"},
    ]
    headings = [f"检查项{number:02d}" for number in range(1, 21)]
    values = ["边界内容" for _ in range(19)] + ["末列表格内容完整"]
    findings[0]["reason"] += (
        "\n\n| " + " | ".join(headings) + " |\n| " + " | ".join(["---"] * 20)
        + " |\n| " + " | ".join(values) + " |"
    )
    for finding in findings:
        if finding.get("path") == paths[0]:
            finding["line_start"] += len(prefix)
            finding["line_end"] += len(prefix)
    # 有意见的文件排在大目录末尾，验证默认定位和目录分页。
    extra_diffs = [{"old_path": f"src/generated-{index}.ts", "new_path": f"src/generated-{index}.ts",
                    "diff": "@@ -0,0 +1 @@\n+export const valid = true;"} for index in range(125)]
    extra_diffs[0].update(old_path="vendor/sample/library.py", new_path="vendor/sample/library.py")
    extra_diffs[1].update(old_path="config/application.yaml", new_path="config/application.yaml")
    excluded = [{"path": item["new_path"], "reason": diff_exclusion(item)} for item in extra_diffs[:2]]
    ReleaseReviewScope.objects.create(
        instance=instance, base_git_hash="a" * 40, head_git_hash=release.git_hash, status="ready", diffs=[
            *extra_diffs,
            {"old_path": paths[0], "new_path": paths[0], "diff": diff},
            {"old_path": paths[1], "new_path": paths[1], "new_file": True,
             "diff": '@@ -0,0 +1,1 @@\n+export const canRemove = () => true;'},
            {"old_path": 'src/review-samples/legacy.ts', "new_path": paths[2], "renamed_file": True,
             "diff": '@@ -1 +1 @@\n-export const version = 1;\n+export const version = 2;'},
        ],
    )
    for field, value in {"endpoint": "https://example.invalid/model/v1", "model": "isolated-review-sample", "protocol": "openai"}.items():
        SystemConfig.objects.update_or_create(key=f"ai_{field}", defaults={"value": value})
    config = save_settings({"skill": "code-review-expert"})
    AIReviewRun.objects.create(
        instance=instance, node_id="ai", settings_version=config, status="partial", findings=findings,
        summary="发现 5 条意见，包含 HTML 渲染、状态更新和操作权限问题，请结合代码逐项复核。",
        coverage={"total_files": 128, "reviewed_files": 125, "eligible_files": 126, "excluded_files": 2, "excluded_paths": excluded, "manifest_complete": False,
                  "reviewed_paths": [item["new_path"] for item in extra_diffs[2:]] + paths[:2],
                  "unreviewed_paths": [paths[2]], "total_fragments": 127, "reviewed_fragments": 126,
                  "warnings": ["远端比较超时，完整清单未知", "上下文未完整读取：critical_dependency.py（源码行 1–100）",
                               *[f"补充上下文未完整读取：dependency-{index}.py" for index in range(80)]],
                  "unread_context": [{"path": "critical_dependency.py", "kind": "read", "start": 1, "end": 100}],
                  "unreviewed_fragments": [{"path": paths[2], "new_start": 1, "new_end": 1, "reason": "批次执行失败"}]},
    )
    # 已关闭的跨轮整改把本次新采纳项放到第二页，验证行内入口能正确跨页定位。
    previous = WorkflowInstance.objects.create(
        definition=definition, biz_type="release", biz_id=str(release.id), source_project=project,
        created_by=owner, status="returned", node_config_snapshot=nodes,
    )
    old_findings = [{"id": str(uuid.uuid4()), "severity": "P2", "title": f"历史整改 {index + 1:02d}",
                     "reason": "已完成的历史虚构样本", "suggestion": ""} for index in range(20)]
    old_run = AIReviewRun.objects.create(
        instance=previous, node_id="ai", settings_version=config, status="completed", findings=old_findings,
    )
    AIReviewRemediation.objects.bulk_create([
        AIReviewRemediation(release=release, instance=previous, run=old_run, finding_id=item["id"],
                            finding=item, status="resolved", source_git_hash="a" * 40,
                            source_token=str(old_run.token)) for item in old_findings
    ])
    filtered_id = create_filtered_sample(project, repository, owner, definition, nodes, config, extra_diffs[:2])
    queued_id = create_complete_directory_sample(project, repository, owner, definition, nodes, config)
    return {"filtered_instance_id": filtered_id, "queued_instance_id": queued_id, "instance_id": str(instance.id), "release_id": str(release.id), "file": paths[0],
            "other_file": paths[1], "finding": findings[0], "source": "虚构固定差异与报告；HTTP、权限、采纳及整改使用生产实现"}



def create_filtered_sample(project, repository, owner, definition, nodes, config, diffs) -> str:
    """使用生产规划与报告函数保存全部过滤的样本，核对流程图和报告状态一致。"""
    from types import SimpleNamespace

    from apps.release.models import ReleaseRecord, ReleaseReviewScope
    from apps.workflow.ai_review_model import _batch_outcome, _batch_plan
    from apps.workflow.models import AIReviewRun, WorkflowInstance, WorkflowTask
    from apps.workflow.services import WorkflowEngine

    release = ReleaseRecord.objects.create(
        project=project, repository=repository, publisher=owner, release_type="rc", status="pending",
        version="VA.99.0.1-rc", tag_name="VA.99.0.1-rc_smoke", branch="main", git_hash="b" * 40,
        release_doc="# 全部过滤验收\n\n虚构依赖与配置变更。",
    )
    instance = WorkflowInstance.objects.create(
        definition=definition, biz_type="release", biz_id=str(release.id), source_project=project,
        created_by=owner, status="running", current_node_id="human", node_config_snapshot=nodes,
        node_status={"ai": "filtered"}, graph_data=WorkflowEngine._build_graph_data(nodes),
    )
    release.workflow_instance = instance
    release.save(update_fields=["workflow_instance"])
    WorkflowTask.objects.create(instance=instance, node_id="human", node_name="人工复核", approver=owner)
    scope = ReleaseReviewScope.objects.create(instance=instance, base_git_hash="a" * 40, head_git_hash="b" * 40,
                                             status="ready", manifest_complete=True, diffs=diffs)
    names, plan, blocked = _batch_plan(SimpleNamespace(settings_version=config), scope)
    outcome = _batch_outcome(scope, names, plan, blocked, {})
    assert outcome["status"] == "filtered"
    AIReviewRun.objects.create(instance=instance, node_id="ai", settings_version=config, **outcome)
    return str(instance.id)


def create_complete_directory_sample(project, repository, owner, definition, nodes, config) -> str:
    """生产 provider 区分完整清单与不可读正文，排队目录使用实际接口展示。"""
    from unittest.mock import patch

    from apps.release.models import ReleaseRecord, ReleaseReviewScope
    from apps.workflow.models import AIReviewRun, WorkflowInstance
    from apps.workflow.services import WorkflowEngine
    from utils.provider.gitlab import GitLabProvider

    provider = GitLabProvider("https://gitlab.example.invalid", {"token": "synthetic"})
    with patch.object(provider, "_review_comparison", return_value={"compare_timeout": False, "diffs": [
        {"old_path": "logo.png", "new_path": "logo.png", "diff": "", "binary": True},
        {"old_path": "src/unreadable.py", "new_path": "src/unreadable.py", "diff": "", "too_large": True},
    ]}):
        result = provider.review_diff("sample/repo", "a" * 40, "b" * 40)
    assert result["manifest_complete"] and not result["complete"]
    release = ReleaseRecord.objects.create(project=project, repository=repository, publisher=owner,
        release_type="rc", status="pending", version="VA.99.0.2-rc", tag_name="VA.99.0.2-rc_smoke",
        branch="main", git_hash="b" * 40, release_doc="# 完整清单验收\n\n虚构不可读正文。")
    instance = WorkflowInstance.objects.create(definition=definition, biz_type="release", biz_id=str(release.id),
        source_project=project, created_by=owner, status="running", current_node_id="ai", node_config_snapshot=nodes,
        node_status={"ai": "running"}, graph_data=WorkflowEngine._build_graph_data(nodes))
    release.workflow_instance = instance
    release.save(update_fields=["workflow_instance"])
    ReleaseReviewScope.objects.create(instance=instance, base_git_hash="a" * 40, head_git_hash="b" * 40,
        status="incomplete", manifest_complete=result["manifest_complete"], diffs=result["diffs"], warnings=result["warnings"])
    AIReviewRun.objects.create(instance=instance, node_id="ai", settings_version=config, status="queued",
        coverage={"total_files": len(result["diffs"]), "reviewed_files": 0, "warnings": result["warnings"]})
    return str(instance.id)

"""隔离浏览器使用的固定 AI 报告与代码差异，不调用外部模型或 Git 服务。"""

import difflib
import uuid


def create_review_sample(project, repository, owner) -> dict:
    """保存虚构的审查快照，通过真实 HTTP 接口读取与采纳。"""
    from apps.release.models import ReleaseRecord, ReleaseReviewScope
    from apps.system.models import SystemConfig
    from apps.system.review_settings import save_settings
    from apps.workflow.models import (
        AIReviewRemediation,
        AIReviewRun,
        WorkflowDefinition,
        WorkflowInstance,
        WorkflowTask,
    )

    nodes = [
        {"node_id": "ai", "node_name": "代码质量审查", "node_type": "ai-review"},
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
    diff = '\n'.join(list(difflib.unified_diff(before, after, n=20, lineterm=''))[2:])
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
    ReleaseReviewScope.objects.create(
        instance=instance, base_git_hash="a" * 40, head_git_hash=release.git_hash, status="ready", diffs=[
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
        instance=instance, node_id="ai", settings_version=config, status="completed", findings=findings,
        summary="发现 5 条意见，包含 HTML 渲染、状态更新和操作权限问题，请结合代码逐项复核。",
        coverage={"total_files": 3, "reviewed_files": 3, "manifest_complete": True, "reviewed_paths": paths},
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
    return {"instance_id": str(instance.id), "release_id": str(release.id), "file": paths[0],
            "other_file": paths[1], "finding": findings[0], "source": "虚构固定差异与报告；HTTP、权限、采纳及整改使用生产实现"}

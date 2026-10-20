# 0006 - 项目角色权限模型

**Status:** accepted
**Date:** 2026-08-03
**Spec:** none
**Deciders:** project maintainers

## Context

历史实现中，项目级权限校验直接依赖 `ProjectMember` 记录：非成员（包括项目负责人
leader）对项目资源不可见、不可写；流程节点编辑等高权限动作仅限 `IsProjectLeader`
（按 `project.leader` 字段判定）。这带来两个问题：

- 项目负责人若未被显式加入成员表，反而看不到自己负责的项目；
- 写权限分散在「成员角色」与「leader 字段」两套语义，动作矩阵难以一眼看清。

需要统一项目内操作的角色授权模型，使 leader 与成员角色语义一致、动作矩阵集中可维护。

## Decision

### 1. 有效角色：leader 视同 manager

在 `utils/permissions.py` 的 `ProjectRolePermission` 中引入 `_effective_role(project, user)`：

- 项目负责人（`project.leader`）在角色判断上视同 `manager`，即使没有 `ProjectMember`
  记录；
- 否则取 `ProjectMember.role`；非成员返回 `None`。

`IsProjectMember` 同样放行 leader，使 leader 隐含为项目成员。

### 2. 可见性统一过滤

在 `apps/project/services.py` 提供 `visible_project_ids(user)`，返回「leader 或成员」
可见的项目 id 子查询集，供各业务视图集 `get_queryset` 统一过滤，替代散落的
`ProjectMember.objects.filter(user=user)` 写法。

### 3. 动作角色矩阵

| 动作 | 所需角色（含 manager） |
|------|------------------------|
| 项目/仓库/打包配置/流程定义 增删改 | manager |
| 项目/组件/发布/任务/说明读取 | 显式项目成员，含 maintainer；超管全部可见 |
| 成员添加 | 除 maintainer 外的项目成员（可授予角色按操作者收缩） |
| 成员角色修改 / 移除 | manager |
| 流程定义节点编辑 | manager（替代原 `IsProjectLeader`） |
| 发布创建/编辑/生成说明/提交审批/推 tag | developer |
| 发布删除 | manager 任意草稿/已驳回；developer 仅本人草稿 |
| 分支直打 | developer / tester |
| 取消打包任务、手动推 SVN | developer |
| 仓库连通性测试、同步提交/分支 | developer |
| 维保项目的发布/说明写入、审批、配置维护、任务删除/取消、SVN 写入 | maintainer 禁止；负责人有效角色与超管仍按原规则 |
| 已发布版本按已有配置补打 | developer / tester / maintainer；独立 `IsProjectReleasePackager`，仅同项目、同仓库的启用配置 |
| 失败任务重试 | maintainer 的独立授权待 Issue #28 实现 |

超管在所有角色校验中默认放行。

### 4. 前端能力

`ProjectSerializer` 输出 `my_role`（leader/超管为 `manager`，非成员为 `None`），
前端 `useProjectRole` 据此控制操作按钮可见性，规则与后端 `IsProjectXxx` 对齐。

## Consequences

- leader 与成员角色语义统一为单一事实来源 `_effective_role`，新增写动作只需声明
  `required_roles`。
- 项目资源可见性对 leader 与成员一致，leader 无需再被显式加入成员表。
- 流程节点编辑权限从「仅 leader」放宽为「manager 成员角色」，leader 仍可操作
  （视同 manager）。
- 新增项目级写接口时，若 project 取自请求体，`has_permission` 会做角色预检；若
  project 由 URL/服务端推断（嵌套资源），须由对象级检查（如
  `NestedProjectPermissionMixin`）兜底。

## Alternatives Considered

- 在 `Project` 创建时强制把 leader 写入 `ProjectMember(role="manager")`：被否决，因为
  leader 与成员是两套数据，强制同步会引入一致性维护成本，且历史项目仍需兼容。
- 维持 `IsProjectLeader` 作为高权限动作专用权限类：被否决，因为 leader 与 manager
  语义重叠会造成两套授权规则并存、易走样，故统一并入角色矩阵并移除 `IsProjectLeader`。

## Update (2026-08-11)

在原决策基础上扩展 `software_admin` 角色：

- `_effective_role` 中成员记录为 `software_admin` 时优先于 leader 等价语义生效；
- `_check` 在 `role == "software_admin"` 时直接放行，使其拥有项目内全部操作权限
  （仓库、发布、打包、成员管理等），无需在 `required_roles` 中重复枚举；
- 新增 `IsProjectPackageAdmin`（`required_roles = ["manager", "software_admin"]`）
  用于打包配置维护语义，其行为与其他子类一致（`software_admin` 仍由 `_check` 放行）。

`software_admin` 与 `manager` 区别：前者在项目内拥有全部操作权限（含通常仅 manager
可做的成员管理），后者仍受 `required_roles` 约束。

## Update (2026-08-28)

成员授权收缩（拉人进项目放开、可授角色分级）：

- 「添加成员」从仅 manager 放宽为全体项目成员（含 leader 隐含成员），但可授予的
  角色按操作者有效角色收缩，规则集中在
  `apps.project.services.get_grantable_roles`：
  - 超管 / leader / manager：全部角色；
  - software_admin：除 manager、software_admin 之外的角色；
  - 其他成员角色（developer/tester/auditor/viewer）：仅 developer、tester。
- 「修改成员角色 / 移除成员」仍仅 manager（software_admin 由 `_check` 放行，但
  修改角色时同样受上述可授集合约束）。
- 校验落在 `ProjectMemberViewSet`（单个/批量添加、更新均走
  `_check_grantable_role`，越权返回 40301）；前端 `useProjectRole` 暴露
  `canAddMember` / `grantableRoles`，角色下拉按同一规则过滤，前后端规则同源。

## Update (2026-09-11)

数据可见范围与操作角色解耦。本更新取代原 Decision 2 与 Consequences 中
“leader 无需成员记录即可见产品资源”的可见性结论，但保留 leader 的有效角色计算语义：

- 超管仍可查看全部产品与仓库；
- 其他用户只可查看具有显式 `ProjectMember` 记录的产品，`leader` 与
  `release.audit` 不再自动扩大产品可见范围；
- 仓库可见范围为“本人创建的仓库”或“已关联到本人所属产品的仓库”；
- `repository.manage` 仅授予仓库维护能力，不绕过上述仓库数据范围；
- `leader` 视同 `manager` 的角色计算语义保持不变，但数据可见性是操作授权的前置条件；
  若需查看或维护产品及其嵌套资源，仍须加入产品成员。

## Update (2026-09-29)

维保人员见 ADR-0024。角色仍然落在项目成员记录上：同一用户在不同项目可以持有不同角色。
不增加「全局唯一角色」，也不在添加或修改成员时做跨项目角色一致性校验。

## 修订（2026-10-14）

Issue #23 增加 `maintainer` 枚举和成员授予能力，仅更新字段选项，不改写已有成员数据。
manager / 超管可授全部角色，software_admin 可授 maintainer，维保不能添加、改角色或移除成员。

维保的写操作限制补充到全局功能权限、仓库所有权与任务分配入口；工作流实例/任务以关联发布的真实项目为权限上下文，不能借共享仓库的其他项目角色修改维保项目。仅担任维保的账号不能借旧全局权限维护镜像和节点；兼任用户保留其他项目及原有全局能力，目标项目的写权限仍单独校验。

指定非成员审批人的既有能力继续保留：在 A 项目担任维保的用户，仍可处理 B 项目显式分配给自己的审批任务。纯维保整账号限制仅用于共享资源写入口（`IsNotOnlyProjectMaintainer`），关联项目的操作由 `IsNotProjectMaintainer` 按真实项目检查。工作流详情也按真实发布所属项目过滤，保留本人作为指定审批人的读取例外；历史收藏不再扩大数据范围，见 ADR-0019 修订。

发布工作流的 `biz_id` 保存为规范 UUID；迁移 `workflow.0010` 规范化存量合法 UUID 的文本表示，业务关联、审批状态、成员数据与无法解析的历史值保持原语义，避免业务解析和权限查询因文本形式不同而产生分歧。

打包任务详情返回 `my_role`、`can_cancel`、`can_delete` 和原有 `can_push_svn`，审批任务返回 `can_act`，工作流实例返回 `can_revoke`。前端据此结合业务状态显示操作入口，后端仍逐次校验请求。

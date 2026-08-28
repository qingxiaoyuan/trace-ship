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
| 成员添加 | 全体成员（可授予角色按操作者收缩，见 2026-08-28 修订） |
| 成员角色修改 / 移除 | manager |
| 流程定义节点编辑 | manager（替代原 `IsProjectLeader`） |
| 发布创建/编辑/生成说明/提交审批/推 tag | developer |
| 发布删除 | manager 任意草稿/已驳回；developer 仅本人草稿 |
| 手动触发打包 | developer / tester |
| 取消打包任务、手动推 SVN | developer |
| 仓库连通性测试、同步提交/分支 | developer |

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

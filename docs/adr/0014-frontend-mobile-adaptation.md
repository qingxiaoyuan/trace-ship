# 0014 - 前端移动端适配：汉堡 + 底部抽屉导航与弹层底部弹出

**状态:** proposed
**日期:** 2026-08-19
**决策者:** 产品/研发团队
**关联规格:** 用户要求"网页在手机上也能显示"；移动端操作区集中在底部（左菜单+当前页、
中间快速发布、右消息+个人中心）；抽屉与弹窗统一从底部弹出

## 背景

前端原以桌面管理后台为目标：`Sidebar` 固定 244px 且 `hidden lg:flex`，lg（1024px）
以下登录后**没有任何导航入口**，手机端完全不可用；另有若干固定宽搜索框/弹层、
触控目标偏小（`h-7 w-7`）、关键信息字号 `text-[10px]`、个别原生 `<table>` 无横滚
兜底等小屏问题。

用户明确要求：移动端导航采用"汉堡 + 抽屉菜单"；手机上抽屉组件和弹窗组件都应
**从底部弹出**；本次做深度适配（触控目标、字号、逐页栅格降级），而非仅"能打开"。

## 决策

1. **断点策略**：沿用 Tailwind 4 断点（`sm` 640 / `md` 768 / `lg` 1024），不引入
   react-responsive 等新媒体查询库；适配一律以"追加 `max-md:` / `sm:` / `md:`
   前缀类"的增量方式进行，桌面端（≥md / ≥lg）样式保持不变。
2. **移动导航**：侧边栏菜单数据（`buildGroups` / `isActivePath`）抽到
   `layouts/components/navMenu.ts`，分组渲染抽为 `SidebarNav.tsx`；桌面 `Sidebar`
   外壳不变。移动端（<lg）顶栏只保留 logo + 当前页标题，操作区集中在
   **底部操作栏 `MobileTabBar`**（双胶囊 + 中央「+」同高对齐，见
   `docs/ui/mobile/mobile-tabbar.html` 方案 C）：左胶囊为菜单入口（唤起底部导航抽屉
   `MobileNavDrawer`）+ 当前页指示，中央为「新建发布」快捷入口，右胶囊为消息
   （未读角标，进 `/notifications`）+ 个人空间（`MobileUserSheet` 底部弹层，
   聚合最近通知、个人中心、使用说明/反馈、退出登录）。顶栏右侧操作（新建/通知/
   用户菜单）仅 ≥lg 显示。
3. **弹层底部弹出（全局方案）**：Modal 全项目 17 处调用 + `TsModal` 封装，不逐页
   改代码，在 `src/index.css` 用 `@media (max-width: 767.98px)`（与 Tailwind
   `max-md` 精确对齐，避免 768px 处与 `md:` 双命中）全局覆盖
   `.ant-modal-wrap / .ant-modal / .ant-modal-container`（注意 AntD 6 内容容器
   类名是 `-container` 而非 v5 的 `-content`）：贴底全宽、顶部圆角、
   `max-height: 85vh`、body 内滚；**不加自定义 animation、不改 wrap 的
   display**（两者分别会导致 rc-motion 关闭动画失效、关闭后隐形层拦截点击，
   已在代码注释中标记）。动画沿用 AntD 默认 zoom，不再自实现 slide-up。
   Drawer 仅 `SvnBrowserDrawer` 用 `Grid.useBreakpoint()` 小屏切
   `placement="bottom"`；`MobileNavDrawer` / `MobileUserSheet` 仅移动端
   可达，直接固定 `placement="bottom"`。
4. **触控与字号基线**：同媒体查询内把 AntD CSS 变量 `--ant-font-size` 提到 14、
   `--ant-control-height` 提到 36；`a/button` 加 `touch-action: manipulation`。
   不设全局 `button { min-height }`，避免冲垮紧凑版式。
5. **逐页适配基线**（适用于全部 `src/pages/`）：
   - 固定宽搜索/筛选框（`w-[200px]~[280px]`）→ `w-full sm:w-[原值]`；
   - Modal 内嵌固定宽侧面板（`w-[340px]` / `w-[240px]`）→ 小屏 `w-full` 并堆叠；
   - 原生 `<table>` 必须有 `overflow-x-auto` 包裹；
   - `grid-cols-12` 行在 <md 下必须有合理 `col-span-*` 降级值；
   - 可点击的 `h-7 w-7` / `h-8 w-8` 图标按钮小屏放大到 ≥36px（`max-md:h-9 w-9`）；
   - 承载关键信息的 `text-[10px]` 小屏抬到 `text-xs`（纯装饰角标不动）。
6. **死代码清理**：删除无任何引用的 `layouts/SystemSubLayout.tsx`。

## 备选方案

- **顶栏汉堡按钮唤起抽屉**：曾是初版实现，后被否。手机端拇指热区在底部，
  操作区（菜单/新建/消息/我的）集中在底部操作栏更顺手，顶栏只承担标题展示。
- **五元素平铺 TabBar（菜单/当前页/＋/消息/我的等宽排列）**：被否。视觉密度高，
  当前页只能退化为纯指示；双胶囊方案在保留 5 个触点的同时按左右手热区分组。
- **三元素聚合（消息并入个人空间）**：被否。审批/构建消息是高频入口，需要
  独立铃铛 + 未读角标一触即达。
- **逐页给 Modal 传响应式 placement/类名**：被否。17 处调用改造成本高、易漏，
  全局 CSS 媒体查询一处覆盖全部；代价是新增 Modal 默认也走底部弹出（符合预期）。
- **移动端独立页面/独立路由**：被否。维护两套页面的成本远超断点适配。

## 影响

- 新增 `layouts/components/navMenu.ts`、`SidebarNav.tsx`、`MobileNavDrawer.tsx`、
  `MobileTabBar.tsx`、`MobileUserSheet.tsx`；`Sidebar.tsx` 重构为复用抽取内容
  （菜单数据与渲染逻辑单一来源）；`TopHeader` 移动端只保留标题。
- `src/index.css` 新增移动端媒体查询块（AntD 变量、Modal 底部弹出、触控基线）。
- 约 40 个页面/组件文件获得断点前缀增量类；桌面端样式不变。
- 新页面约定：工具栏输入框、列表行、弹窗内容均需自检 375px 下不溢出；该约定已
  写入 AGENTS.md「前端架构」节。

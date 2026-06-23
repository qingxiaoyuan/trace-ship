import { useMemo } from "react";
import { Menu, Layout, Typography } from "antd";
import {
  DashboardOutlined,
  ProjectOutlined,
  DatabaseOutlined,
  KeyOutlined,
  FileSearchOutlined,
  TagsOutlined,
  BuildOutlined,
  NodeIndexOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { useLocation, useNavigate } from "react-router-dom";
import { tokens } from "@/styles/theme";

const { Sider } = Layout;
const { Title, Text } = Typography;

const menuItems = [
  { key: "/", icon: <DashboardOutlined />, label: "工作台" },
  { key: "/projects", icon: <ProjectOutlined />, label: "项目管理" },
  { key: "/repositories", icon: <DatabaseOutlined />, label: "仓库管理" },
  { key: "/credentials", icon: <KeyOutlined />, label: "凭证管理" },
  { key: "/commits", icon: <FileSearchOutlined />, label: "提交规范审查" },
  { key: "/tags", icon: <TagsOutlined />, label: "Tag 生成与发布" },
  { key: "/jenkins", icon: <BuildOutlined />, label: "Jenkins 构建" },
  { key: "/workflows", icon: <NodeIndexOutlined />, label: "工作流审批" },
  {
    key: "/system",
    icon: <SettingOutlined />,
    label: "系统管理",
    children: [
      { key: "/system/users", label: "用户管理" },
      { key: "/system/roles", label: "角色权限" },
      { key: "/system/configs", label: "系统配置" },
      { key: "/system/logs", label: "操作日志" },
    ],
  },
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedKey = useMemo(() => {
    const path = location.pathname;
    const findKey = (items: typeof menuItems): string | undefined => {
      for (const item of items) {
        if (path === item.key || path.startsWith(`${item.key}/`)) {
          return item.key;
        }
        if (item.children) {
          const childKey = findKey(item.children as typeof menuItems);
          if (childKey) return childKey;
        }
      }
      return undefined;
    };
    return findKey(menuItems) || "/";
  }, [location.pathname]);

  return (
    <Sider
      width={tokens.layout.sidebarWidth}
      style={{
        overflow: "auto",
        height: "100vh",
        position: "fixed",
        left: 0,
        top: 0,
        bottom: 0,
        background: tokens.colors.surface,
        borderRight: `1px solid ${tokens.colors.border}`,
        zIndex: 100,
      }}
    >
      <div
        className="flex items-center px-5"
        style={{ height: tokens.layout.headerHeight }}
      >
        <img
          src="/favicon.ico"
          alt="溯舟"
          className="w-9 h-9 rounded-xl mr-3 object-contain"
        />
        <div className="flex flex-col">
          <Title
            level={5}
            className="!m-0"
            style={{ color: tokens.colors.textPrimary }}
          >
            溯舟
          </Title>
          <Text
            className="text-[10px] tracking-wider"
            style={{ color: tokens.colors.textMuted }}
          >
            TRACE-SHIP
          </Text>
        </div>
      </div>

      <div className="px-3">
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{
            borderRight: 0,
            background: "transparent",
          }}
        />
      </div>
    </Sider>
  );
}

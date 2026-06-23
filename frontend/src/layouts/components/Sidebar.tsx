import { useMemo } from "react";
import { Menu, Layout, Typography } from "antd";
import type { ItemType, MenuItemType } from "antd/es/menu/interface";
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
  RocketOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useLocation, useNavigate } from "react-router-dom";
import { tokens } from "@/styles/theme";
import { useAuthStore } from "@/stores/authStore";
import type { MenuItem } from "@/types";

const { Sider } = Layout;
const { Title, Text } = Typography;

const iconMap: Record<string, React.ReactNode> = {
  DashboardOutlined: <DashboardOutlined />,
  ProjectOutlined: <ProjectOutlined />,
  DatabaseOutlined: <DatabaseOutlined />,
  KeyOutlined: <KeyOutlined />,
  FileSearchOutlined: <FileSearchOutlined />,
  TagsOutlined: <TagsOutlined />,
  BuildOutlined: <BuildOutlined />,
  NodeIndexOutlined: <NodeIndexOutlined />,
  SettingOutlined: <SettingOutlined />,
  RocketOutlined: <RocketOutlined />,
  UserOutlined: <UserOutlined />,
};

function mapMenus(items: MenuItem[]): MenuItemType[] {
  return items.map((item) => {
    const menuItem: MenuItemType = {
      key: item.path,
      icon: iconMap[item.icon] || null,
      label: item.name,
    };
    if (item.children && item.children.length > 0) {
      menuItem.children = mapMenus(item.children);
    }
    return menuItem;
  });
}

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const menus = useAuthStore((state) => state.menus);

  const menuItems = useMemo(() => mapMenus(menus), [menus]);

  const selectedKey = useMemo(() => {
    const path = location.pathname;
    const findKey = (items: ItemType[]): string | undefined => {
      for (const item of items) {
        if (!item || typeof item !== "object" || "type" in item) continue;
        const key = (item as any).key as string;
        if (path === key || path.startsWith(`${key}/`)) {
          return key;
        }
        const children = (item as any).children as ItemType[] | undefined;
        if (children) {
          const childKey = findKey(children);
          if (childKey) return childKey;
        }
      }
      return undefined;
    };

    const key = findKey(menuItems);
    // /dashboard 与 / 都对应首页菜单
    if (!key && (path === "/" || path === "/dashboard")) {
      return "/dashboard";
    }
    return key || "/";
  }, [location.pathname, menuItems]);

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

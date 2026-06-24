import { useMemo } from "react";
import { Menu, Layout, Typography } from "antd";
import type { MenuProps } from "antd";
import {
  AppstoreOutlined,
  FolderOutlined,
  DatabaseOutlined,
  KeyOutlined,
  FileTextOutlined,
  TagsOutlined,
  PlayCircleOutlined,
  ProfileOutlined,
  RocketOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useLocation, useNavigate } from "react-router-dom";
import { tokens } from "@/styles/theme";
import { useAuthStore } from "@/stores/authStore";
import type { MenuItem } from "@/types";

const { Sider } = Layout;
const { Title, Text } = Typography;

const iconMap: Record<string, React.ReactNode> = {
  AppstoreOutlined: <AppstoreOutlined />,
  FolderOutlined: <FolderOutlined />,
  DatabaseOutlined: <DatabaseOutlined />,
  KeyOutlined: <KeyOutlined />,
  FileTextOutlined: <FileTextOutlined />,
  TagsOutlined: <TagsOutlined />,
  PlayCircleOutlined: <PlayCircleOutlined />,
  ProfileOutlined: <ProfileOutlined />,
  RocketOutlined: <RocketOutlined />,
  SettingOutlined: <SettingOutlined />,
  UserOutlined: <UserOutlined />,
};

type AntdMenuItem = NonNullable<MenuProps["items"]>[number];

function mapMenus(items: MenuItem[]): AntdMenuItem[] {
  return items.map((item) => {
    const base = {
      key: item.path,
      icon: iconMap[item.icon] || null,
      label: item.name,
    };
    if (item.children && item.children.length > 0) {
      return { ...base, children: mapMenus(item.children) };
    }
    return base;
  });
}

function isMenuItemWithChildren(
  item: AntdMenuItem
): item is AntdMenuItem & { children: AntdMenuItem[] } {
  return (
    !!item &&
    typeof item === "object" &&
    !("type" in item) &&
    "children" in item &&
    Array.isArray((item as { children?: unknown }).children)
  );
}

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const menus = useAuthStore((state) => state.menus);

  const menuItems = useMemo(() => mapMenus(menus), [menus]);

  const selectedKey = useMemo(() => {
    const path = location.pathname;
    const findKey = (items: AntdMenuItem[]): string | undefined => {
      for (const item of items) {
        if (!item || typeof item !== "object" || "type" in item) continue;
        const key = String((item as { key?: React.Key }).key);
        if (path === key || path.startsWith(`${key}/`)) {
          return key;
        }
        if (isMenuItemWithChildren(item)) {
          const childKey = findKey(item.children);
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

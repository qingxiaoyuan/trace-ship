import { useState, useEffect } from "react";
import { Grid, message } from "antd";
import { useNavigate } from "react-router-dom";
import {
  User,
  Lock,
  EyeOff,
  Eye,
  Check,
  Info,
  ScanSearch,
  Hammer,
  GitPullRequestArrow,
  Tag,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";

type LoginTab = "domain" | "local";

const tabs: { key: LoginTab; label: string }[] = [
  { key: "domain", label: "域账号登录" },
  { key: "local", label: "本地账号" },
];

const featureList = [
  {
    icon: ScanSearch,
    text: "Conventional Commits 提交规范自动审查",
    iconClass: "icon-indigo",
  },
  {
    icon: Hammer,
    text: "内置打包任务实时监控与日志追踪",
    iconClass: "icon-cyan",
  },
  {
    icon: GitPullRequestArrow,
    text: "可配置多级审批工作流，支持会签转交",
    iconClass: "icon-violet",
  },
  {
    icon: Tag,
    text: "语义化版本号自动计算，审批后自动推 Tag",
    iconClass: "icon-emerald",
  },
];

export default function Login() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hydrated = useAuthStore((state) => state.hydrated);

  const [activeTab, setActiveTab] = useState<LoginTab>("domain");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ username?: string; password?: string }>({});

  // 移动端（<lg）采用常见手机登录 UI：无卡片、居中品牌区、分段 Tab、大号输入框
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.lg;

  useEffect(() => {
    if (hydrated && isAuthenticated) {
      navigate("/", { replace: true });
    }
  }, [hydrated, isAuthenticated, navigate]);

  const validate = () => {
    const nextErrors: { username?: string; password?: string } = {};
    if (!username.trim()) {
      nextErrors.username = "请输入用户名";
    }
    if (!password) {
      nextErrors.password = "请输入密码";
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      await login(username.trim(), password);
      message.success("登录成功");
      navigate("/");
    } catch (err: unknown) {
      console.error("登录失败:", err);
      const errorMessage =
        (err instanceof Error ? err.message : "") ||
        (typeof err === "string" ? err : "") ||
        (err && typeof err === "object" && "message" in err
          ? String(err.message)
          : "") ||
        "登录失败";
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#F6F7FB] text-slate-700 text-[14px] relative min-h-screen">
      <div className="aurora" />
      <div className="aurora-3" />

      <div className="relative z-10 min-h-screen flex justify-center">
        <div className="w-full max-w-[1440px] min-h-screen grid lg:grid-cols-2">
          {/* 左侧品牌展示区 */}
          <div className="hidden lg:flex flex-col justify-center grid-bg p-10 xl:p-20 relative overflow-hidden">
            {/* 顶部 Logo */}
            <div className="flex items-center gap-2.5 absolute top-10 left-10 xl:top-20 xl:left-20 z-10">
              <img
                src="/favicon.ico"
                alt="溯舟"
                className="h-9 w-9 rounded-lg object-contain"
              />
              <div className="flex flex-col leading-none">
                <span className="text-[17px] font-semibold tracking-tight text-slate-900">
                  溯舟
                </span>
                <span className="mt-0.5 text-[10px] font-medium tracking-[0.14em] text-indigo-400 uppercase">
                  Trace Ship
                </span>
              </div>
            </div>

            {/* 中部标语 */}
            <div className="relative z-10 max-w-md xl:max-w-lg -mt-12">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200/60 bg-indigo-50/50 px-2.5 py-1 mb-6">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 pulse-dot" />
                <span className="text-[11px] font-medium text-indigo-600">
                  软件版本发布管理系统 · v2.4.0
                </span>
              </div>
              <h1 className="text-[40px] xl:text-[44px] leading-[1.15] font-semibold tracking-tight text-slate-900">
                让每一次
                <br />
                <span className="text-gradient">发布可追溯</span>
              </h1>
              <p className="mt-4 text-[14px] leading-relaxed text-slate-500">
                集成 Git / SVN 与内置打包，统一管理项目发布全流程。
                提交规范审查、自动化打包、多级审批、一键推 Tag，让版本交付安全高效。
              </p>

              {/* 特性列表 */}
              <div className="mt-8 space-y-3">
                {featureList.map((item) => (
                  <div key={item.text} className="flex items-center gap-2.5">
                    <div
                      className={`flex h-7 w-7 items-center justify-center rounded-lg ${item.iconClass}`}
                    >
                      <item.icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </div>
                    <span className="text-[13px] text-slate-600">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 右侧登录表单区 */}
          <div className="flex items-center justify-center p-6 max-lg:items-start max-lg:pt-[10vh] sm:p-10 sm:max-lg:pt-[10vh] xl:p-20">
            <div
              className={
                isMobile
                  ? "w-full"
                  : "glass w-full max-w-[400px] xl:max-w-[420px] rounded-2xl p-7 sm:p-8 xl:p-9"
              }
              style={
                isMobile
                  ? undefined
                  : { boxShadow: "0 12px 40px -10px rgba(79,70,229,.15)" }
              }
            >
              {/* 移动端品牌区（居中） */}
              {isMobile ? (
                <div className="mb-8 flex flex-col items-center text-center">
                  <img
                    src="/favicon.ico"
                    alt="溯舟"
                    className="h-14 w-14 rounded-2xl object-contain"
                  />
                  <div className="mt-3 text-[18px] font-semibold tracking-tight text-slate-900">
                    溯舟
                  </div>
                  <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-indigo-400">
                    Trace Ship
                  </div>
                  <div className="mt-2 text-[12px] text-slate-400">
                    让每一次发布可追溯
                  </div>
                </div>
              ) : null}

              {/* 标题 */}
              <div className="mb-6 max-lg:text-center">
                <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">
                  欢迎回来
                </h2>
                <p className="mt-1 text-[13px] text-slate-500">
                  登录以管理你的发布流程
                </p>
              </div>

              {/* Tab 切换（移动端为分段控件） */}
              <div
                className={`mb-6 flex items-center ${
                  isMobile
                    ? "gap-1 rounded-xl border border-indigo-100 bg-indigo-50/40 p-1"
                    : "gap-5 border-b border-slate-200"
                }`}
              >
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={
                      isMobile
                        ? `login-tab flex-1 rounded-lg py-2 text-center text-[13px] font-medium after:hidden ${
                            activeTab === tab.key
                              ? "bg-white text-indigo-600 shadow-sm"
                              : "text-slate-500"
                          }`
                        : `login-tab pb-2.5 text-[13px] font-medium text-slate-500 ${activeTab === tab.key ? "on" : ""}`
                    }
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* 表单 */}
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* 用户名 */}
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">
                    用户名
                  </label>
                  <div className="relative">
                    <User
                      className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none"
                      strokeWidth={1.5}
                    />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value);
                        if (errors.username) setErrors((p) => ({ ...p, username: undefined }));
                      }}
                      placeholder={
                        activeTab === "domain"
                          ? "请输入域账号 / 用户名"
                          : "请输入本地账号"
                      }
                      className="input-field w-full rounded-lg border border-slate-200 bg-white/70 pl-9 pr-3 py-2.5 text-[13px] text-slate-700 placeholder-slate-400 outline-none max-lg:rounded-xl max-lg:py-3 max-lg:text-[14px]"
                    />
                  </div>
                  {errors.username && (
                    <p className="mt-1 text-[12px] text-rose-500">{errors.username}</p>
                  )}
                </div>

                {/* 密码 */}
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">
                    密码
                  </label>
                  <div className="relative">
                    <Lock
                      className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none"
                      strokeWidth={1.5}
                    />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (errors.password) setErrors((p) => ({ ...p, password: undefined }));
                      }}
                      placeholder="请输入密码"
                      className="input-field w-full rounded-lg border border-slate-200 bg-white/70 pl-9 pr-10 py-2.5 text-[13px] text-slate-700 placeholder-slate-400 outline-none max-lg:rounded-xl max-lg:py-3 max-lg:text-[14px]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-600"
                    >
                      {showPassword ? (
                        <Eye className="h-4 w-4" strokeWidth={1.5} />
                      ) : (
                        <EyeOff className="h-4 w-4" strokeWidth={1.5} />
                      )}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="mt-1 text-[12px] text-rose-500">{errors.password}</p>
                  )}
                </div>

                {/* 记住我 / 忘记密码 */}
                <div className="flex items-center justify-between text-[12px]">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <span className="relative inline-flex h-4 w-4 items-center justify-center rounded border border-slate-300 bg-white transition-colors hover:border-indigo-400">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                      />
                      <Check
                        className="h-3 w-3 text-indigo-600 opacity-0 peer-checked:opacity-100 absolute"
                        strokeWidth={2.5}
                      />
                    </span>
                    <span className="text-slate-600">记住我</span>
                  </label>
                  <a className="font-medium text-indigo-600 hover:text-indigo-500 cursor-pointer">
                    忘记密码？
                  </a>
                </div>

                {/* 登录按钮 */}
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-glow w-full rounded-lg py-2.5 text-[14px] font-medium text-white mt-2 border-0 cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed max-lg:rounded-xl max-lg:py-3 max-lg:text-[15px]"
                >
                  {loading ? "登录中..." : "登 录"}
                </button>
              </form>

              {/* 底部提示 */}
              <div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                <Info className="h-3 w-3" strokeWidth={1.5} />
                <span>首次登录将自动同步 LDAP 用户信息</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

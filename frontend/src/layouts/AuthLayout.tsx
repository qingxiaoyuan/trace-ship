export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: `
          radial-gradient(circle at 0% 0%, rgba(59, 130, 246, 0.12) 0%, transparent 35%),
          radial-gradient(circle at 100% 100%, rgba(139, 92, 246, 0.10) 0%, transparent 35%),
          linear-gradient(135deg, #F0F9FF 0%, #EFF6FF 50%, #F5F3FF 100%)
        `,
      }}
    >
      {children}
    </div>
  );
}

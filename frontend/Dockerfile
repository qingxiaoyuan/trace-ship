# 构建阶段：安装依赖并打包
FROM node:22-alpine AS builder

WORKDIR /app

# 启用 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 复制依赖清单与工作区配置
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# 允许依赖执行 postinstall 脚本
RUN pnpm approve-builds --all

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# 运行阶段：使用 nginx 提供静态资源
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 修复静态文件权限：构建产物中若存在仅所有者可读的文件（如 favicon.ico），Nginx worker 会返回 403
RUN chmod -R a+r /usr/share/nginx/html && find /usr/share/nginx/html -type d -exec chmod a+x {} \;

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

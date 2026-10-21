# 构建阶段：安装依赖并打包
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# 安装依赖时保留 lockfile；Node 24 镜像使用兼容的补丁版本。
COPY package.json package-lock.json .npmrc ./
COPY scripts ./scripts
RUN npm ci

COPY . .
RUN npm run build

# 运行阶段：使用 nginx 提供静态资源
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 修复静态文件权限：构建产物中若存在仅所有者可读的文件（如 favicon.ico），Nginx worker 会返回 403
RUN chmod -R a+r /usr/share/nginx/html && find /usr/share/nginx/html -type d -exec chmod a+x {} \;

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

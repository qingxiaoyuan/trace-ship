-- 创建 release_manager 主库
-- 已在 docker-compose 环境变量中通过 POSTGRES_DB 创建，这里可做扩展初始化

-- 创建 Gitea 专用库
CREATE USER gitea WITH PASSWORD 'Gitea@2024';
CREATE DATABASE gitea OWNER gitea;
GRANT ALL PRIVILEGES ON DATABASE gitea TO gitea;

-- 扩展 release_manager 用户权限（如需要）
GRANT ALL PRIVILEGES ON DATABASE release_manager TO release_manager;

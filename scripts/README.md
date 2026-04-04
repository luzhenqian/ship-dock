# YiOne 部署指南

## 目录结构

```
scripts/
  deploy.config.example.sh   # 配置模板（需复制后填写）
  server-setup.sh             # 服务器环境初始化脚本
  deploy-remote.sh            # 服务器端部署脚本
  deploy.sh                   # 本地手动触发部署
  db-backup.sh                # 数据库备份脚本
.github/workflows/
  deploy.yml                  # GitHub Actions 自动部署
```

## 一、准备配置文件

```bash
cp scripts/deploy.config.example.sh scripts/deploy.config.sh
```

编辑 `scripts/deploy.config.sh`，填写以下字段：

| 字段                 | 说明             | 示例               |
| -------------------- | ---------------- | ------------------ |
| `SERVER_HOST`        | 服务器 IP 或域名 | `1.2.3.4`          |
| `SSH_USER`           | SSH 登录用户名   | `root`             |
| `PEM_PATH`           | SSH 私钥路径     | `~/.ssh/yione.pem` |
| `SSH_PORT`           | SSH 端口         | `22`               |
| `PROJECT_DIR`        | 服务器上项目路径 | `/opt/yione`       |
| `GIT_BRANCH`         | 部署分支         | `main`             |
| `DB_NAME`            | 数据库名称       | `yione`            |
| `DB_USER`            | 数据库用户名     | `yione`            |
| `DB_PASSWORD`        | 数据库密码       | 自行设置强密码     |
| `JWT_SECRET`         | JWT 签名密钥     | 自行设置           |
| `JWT_REFRESH_SECRET` | JWT 刷新密钥     | 自行设置           |

> **注意：** `deploy.config.sh` 和 `*.pem` 文件已被 `.gitignore` 忽略，不会上传到 GitHub。

## 二、初始化服务器环境（首次）

```bash
./scripts/server-setup.sh
```

该脚本会通过 SSH 连接到服务器，自动检测并安装以下组件：

- **Node.js 20** — 运行环境
- **pnpm 9.15.4** — 包管理器
- **PostgreSQL 16** — 数据库
- **pgvector** — 向量搜索扩展
- **Redis 7** — 缓存
- **Nginx** — 反向代理
- **PM2** — 进程管理
- **Git** — 版本控制

每个组件在安装前都会检测是否已存在，存在则跳过。脚本还会自动创建数据库和用户、启用 pgvector 扩展。

## 三、首次部署（手动完成）

服务器环境就绪后，SSH 登录服务器完成以下操作：

```bash
ssh -i ~/.ssh/yione.pem root@你的服务器IP
```

> **注意：** 首次运行 `./scripts/deploy.sh` 时，脚本会自动检测服务器上是否有源代码。如果没有，会通过 rsync 将本地代码上传到服务器（排除 node_modules、dist 等）。无需手动克隆。

### 1. 创建服务器端环境变量

```bash
cat > apps/server/.env << 'EOF'
DATABASE_URL="postgresql://yione:你的数据库密码@localhost:5432/yione"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="你的JWT密钥"
JWT_REFRESH_SECRET="你的JWT刷新密钥"
NODE_ENV=production
PORT=4000
EOF
```

### 3. 配置 SSL 证书

将证书文件放到 Nginx 配置中指定的路径：

```bash
mkdir -p /etc/nginx/ssl
# 将你的证书文件复制到以下位置：
# /etc/nginx/ssl/yione.pem
# /etc/nginx/ssl/yione.key
```

### 4. 执行首次部署

回到本地机器运行：

```bash
./scripts/deploy.sh
```

## 四、日常部署

### 方式一：本地手动触发

```bash
./scripts/deploy.sh
```

### 方式二：GitHub Actions 自动触发

推送代码到 `main` 分支时自动部署。需要在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中配置以下 Secrets：

| Secret 名称       | 说明                                |
| ----------------- | ----------------------------------- |
| `SERVER_HOST`     | 服务器 IP                           |
| `SERVER_USER`     | SSH 用户名                          |
| `SSH_PRIVATE_KEY` | SSH 私钥完整内容（不是路径）        |
| `SSH_PORT`        | SSH 端口（可选，默认 22）           |
| `DEPLOY_DIR`      | 项目路径（可选，默认 `/opt/yione`） |

也支持在 GitHub Actions 页面手动触发（workflow_dispatch）。

### 部署流程

每次部署自动执行以下步骤：

1. `git pull` — 拉取最新代码
2. `pnpm install` — 安装依赖
3. `prisma generate` — 生成 Prisma 客户端
4. `prisma migrate deploy` — 执行数据库迁移
5. `pnpm turbo build` — 构建后端项目
6. 同步 Nginx 配置并 reload
7. `pm2 reload` — 零停机重启服务
8. 健康检查 — 验证服务是否正常

## 五、常用运维命令

```bash
# 查看服务状态
pm2 status

# 查看实时日志
pm2 logs yione-api

# 手动重启
pm2 reload ecosystem.config.js --env production

# 数据库备份
./scripts/db-backup.sh daily

# Nginx 配置测试
nginx -t

# 查看 PostgreSQL 状态
systemctl status postgresql

# 查看 Redis 状态
systemctl status redis-server
```

## 六、故障排查

| 问题           | 排查方式                                      |
| -------------- | --------------------------------------------- |
| 服务启动失败   | `pm2 logs yione-api --lines 50`               |
| 数据库连接失败 | 检查 `apps/server/.env` 中的 `DATABASE_URL`   |
| Nginx 502      | 确认 PM2 服务是否在运行：`pm2 status`         |
| 健康检查失败   | `curl http://localhost:4000/health`           |
| 迁移失败       | `cd apps/server && npx prisma migrate status` |

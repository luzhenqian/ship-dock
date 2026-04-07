# 项目迁移指南

将现有项目从传统服务器或云平台迁移到 Ship Dock。

---

## 迁移方式

Ship Dock 提供两种迁移路径：

| 方式 | 适用场景 | 操作方式 |
|------|----------|----------|
| **服务器迁移** | 项目运行在 VPS / 独立服务器上 | 在源服务器运行 CLI 工具自动扫描并上传 |
| **云平台迁移** | 项目部署在 Vercel、Netlify 等 Serverless 平台 | 在 Ship Dock 界面手动连接远程服务 |

---

## 方式一：从服务器迁移（CLI）

适用于通过 PM2、Docker、systemd 等方式运行的项目。

### 1. 在 Ship Dock 中创建迁移任务

1. 登录 Ship Dock，进入 **Dashboard**
2. 点击 **Import Projects**
3. 选择 **Server / VPS**
4. 页面会显示一条 CLI 命令，包含 API 地址和临时 Token（有效期 2 小时）

### 2. 在源服务器运行 CLI

SSH 登录源服务器，执行页面显示的命令：

```bash
npx ship-dock-migrate export \
  --url https://your-shipdock-api.com/api \
  --token <your-token> \
  --import-id <import-id>
```

也可以不带参数运行，CLI 会交互式提示输入：

```bash
npx ship-dock-migrate
```

**CLI 参数说明：**

| 参数 | 说明 |
|------|------|
| `-s, --server <url>` | Ship Dock API 地址 |
| `-t, --token <token>` | API Token |
| `--scan-only` | 仅扫描不上传，用于预览检测结果 |

### 3. CLI 自动扫描与收集

CLI 会自动检测以下运行方式的项目：

- **PM2** — 读取 `pm2 jlist`，提取进程名、工作目录、环境变量
- **Docker / Docker Compose** — 读取容器信息、端口映射、挂载卷
- **systemd** — 扫描 `/etc/systemd/system/*.service`
- **Nginx** — 解析反向代理配置，提取域名和 SSL 证书路径
- **裸进程** — 匹配 node、python、java、php 等进程
- **Cron** — 读取 `crontab -l`，关联到对应项目

检测到项目后，CLI 会收集：

- 代码来源（git remote + commit hash，或打包目录）
- 数据库导出（`pg_dump` / `mysqldump`）
- Redis 数据（RDB 快照）
- 环境变量（`.env` 文件）
- Nginx 配置和 SSL 证书信息
- Cron 定时任务

**示例输出：**

```
Scanning server...

Found 3 projects:
  1. my-api        PM2      :3001  api.example.com    PostgreSQL, Redis
  2. blog-app      Docker   :3002  blog.example.com   PostgreSQL
  3. worker        systemd  :3003                     Redis

Select projects to migrate: (all selected)

Packaging 3 projects...
  my-api:    code OK  database (245MB) OK  redis OK  env OK
  blog-app:  code OK  database (1.2GB) OK  env OK
  worker:    code OK  redis OK  env OK

Uploading to Ship Dock... 100%

Done! Continue import at: https://your-shipdock.com/import/abc123/preview
```

### 4. 在 Ship Dock 中完成导入

CLI 上传完成后，Ship Dock 前端会自动跳转到项目预览页面：

**a) 项目预览** — 查看检测到的所有项目，勾选要导入的

**b) 配置映射** — 逐个项目确认配置：
- 项目名称和 slug
- Git 仓库地址
- 域名绑定
- 端口分配
- 环境变量（系统自动识别数据库、Redis、存储相关变量并替换为 Ship Dock 本地地址）
- 数据库冲突策略（覆盖 / 跳过 / 追加 / 报错）

**c) 执行导入** — 点击确认后，系统自动执行：

```
my-api
  ✅ 创建项目
  ✅ 创建数据库
  ✅ 导入数据库数据
  ✅ 创建 Redis
  ✅ 导入 Redis 数据
  ✅ 创建存储桶
  ✅ 同步存储文件
  ✅ 设置环境变量
  ✅ 配置定时任务
  ⏳ 部署中...
  ⬚ 切换 DNS
```

每个阶段独立执行，单个项目失败不影响其他项目。失败的项目可以从失败阶段重试。

---

## 方式二：从云平台迁移（Serverless）

适用于部署在 Vercel、Netlify、Railway 等平台的项目。

### 1. 开始迁移

1. 登录 Ship Dock，进入 **Dashboard**
2. 点击 **Import Projects**
3. 选择 **Cloud / Serverless**

### 2. 填写项目信息

**项目基本信息：**
- 项目名称
- GitHub 仓库地址
- 分支名（默认 `main`）

**连接远程数据服务（按需添加）：**

| 服务类型 | 需要填写 |
|----------|----------|
| PostgreSQL | Host、Port、用户名、密码、数据库名 |
| Redis | 连接 URL（如 `redis://host:6379/0`） |
| S3 / MinIO | Endpoint、Access Key、Secret Key、Bucket 名 |

每个服务填写后可以点击 **Test Connection** 验证连通性。

**环境变量：**

直接粘贴 `.env` 文件内容，或从原平台导出后粘贴。系统会自动识别数据库、Redis、存储相关的变量，并在迁移后替换为 Ship Dock 本地服务地址。

### 3. 确认配置并执行

与服务器迁移相同的配置映射和执行流程。

---

## 环境变量自动映射

迁移时，系统会自动识别以下环境变量并建议替换为 Ship Dock 本地服务地址：

| 识别规则 | 示例变量 |
|----------|----------|
| PostgreSQL 连接串 | `DATABASE_URL=postgresql://...` |
| MySQL 连接串 | `DATABASE_URL=mysql://...`（会提示需要手动转换） |
| Redis 连接串 | `REDIS_URL=redis://...` |
| 变量名匹配 | `DB_HOST`、`REDIS_HOST`、`S3_ENDPOINT`、`MINIO_BUCKET` 等 |

在配置映射步骤中，被识别的变量会显示 **auto-mapped** 标记，展示原始值和建议替换值。你可以：
- 接受建议值
- 手动修改
- 点击 **keep original** 保留原始值（适用于继续使用外部服务的场景）

> **注意：** 如果源项目使用 MySQL，Ship Dock 使用 PostgreSQL，数据库数据需要手动转换。系统会在界面上明确提示。

---

## DNS 切换

项目导入并部署成功后，需要将域名指向 Ship Dock 服务器：

**已绑定域名提供商（Namecheap / GoDaddy）：** 界面上会显示"自动切换 DNS"按钮，一键完成。

**未绑定域名提供商：** 界面会显示需要手动配置的 DNS 记录：

```
请更新以下 DNS 记录：

api.example.com  →  A     54.174.82.13
blog.example.com →  CNAME dock.example.com
```

配置完成后，可以点击"检测 DNS 生效"按钮验证是否已切换成功。

---

## 限制与注意事项

### 当前版本限制

- 数据库迁移仅支持 PostgreSQL 和 MySQL（MySQL 需手动转换数据格式）
- 不支持 MongoDB 数据迁移
- 每次只能迁移一台源服务器
- Docker 项目迁移后将使用 PM2 运行（需从容器中提取源码）
- CLI 工具仅支持 Linux 服务器（不支持 Windows）

### 大小限制

| 项目 | 限制 |
|------|------|
| 单项目数据库导出 | 10 GB |
| 单项目对象存储 | 20 GB |
| 迁移包总大小 | 50 GB |

超出限制建议分批迁移或手动处理大数据。

### 停机时间

迁移过程中源服务器的项目会继续运行，不会自动停止。但迁移的是执行时刻的数据快照，迁移期间源服务器产生的新数据不会同步。建议：

1. 在业务低峰期执行迁移
2. 迁移完成后验证数据完整性
3. 确认无误后切换 DNS
4. 切换后停止源服务器上的旧服务

---

## 常见问题

**Q: CLI 扫描没有检测到我的项目？**

确保项目正在运行。CLI 通过检查运行中的进程（PM2、Docker、systemd）来发现项目。如果项目已停止，不会被检测到。可以用 `--scan-only` 参数先预览检测结果。

**Q: 环境变量中有敏感信息，传输安全吗？**

CLI 与 Ship Dock 之间的通信通过 HTTPS 加密。环境变量在 Ship Dock 中使用 AES-256 加密存储。上传使用临时 Token，有效期 2 小时。

**Q: 迁移失败了怎么办？**

每个项目的每个阶段独立执行。如果某个阶段失败：
- 查看该阶段的详细日志定位问题
- 修复问题后可以从失败阶段重试
- 也可以跳过该项目，继续其他项目的迁移

**Q: 可以迁移多台服务器的项目吗？**

可以，但需要分多次迁移。每次在一台服务器上运行 CLI，完成导入后再处理下一台。

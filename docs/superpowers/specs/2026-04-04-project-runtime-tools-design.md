# Project Runtime Tools — Design Spec

在项目详情页集成运行时数据查看和管理工具，包括实时日志、PostgreSQL 浏览器、Redis 浏览器和 MinIO 文件管理器。

## 架构方案

**直连模式**：Ship-Dock 后端直接连接目标项目的 PostgreSQL、Redis、MinIO，读取 PM2 日志文件。适用于 Ship-Dock 与被部署项目在同一台服务器的场景。

## 数据模型

新增 `ServiceConnection` 模型，存储项目关联的服务连接信息：

```prisma
model ServiceConnection {
  id           String      @id @default(uuid())
  projectId    String
  project      Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  type         ServiceType
  name         String        // 用户自定义名称，如 "主数据库"
  config       String        // AES-256 加密的 JSON 连接配置
  autoDetected Boolean       @default(false)
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
}

enum ServiceType {
  POSTGRESQL
  REDIS
  MINIO
}
```

连接配置的 JSON 结构：

```typescript
// PostgreSQL
{ host: string, port: number, database: string, user: string, password: string, ssl?: boolean }

// Redis
{ host: string, port: number, password?: string, db?: number }

// MinIO
{ endPoint: string, port: number, accessKey: string, secretKey: string, useSSL?: boolean }
```

## 连接信息自动识别

从项目环境变量中自动识别已知变量，同时支持用户手动添加/覆盖。

| 服务 | 识别的环境变量 |
|------|----------------|
| PostgreSQL | `DATABASE_URL`, `PG_HOST`+`PG_PORT`+`PG_DATABASE`+`PG_USER`+`PG_PASSWORD`, `POSTGRES_HOST`+`POSTGRES_PORT`+`POSTGRES_DB`+`POSTGRES_USER`+`POSTGRES_PASSWORD` |
| Redis | `REDIS_URL`, `REDIS_HOST`+`REDIS_PORT` |
| MinIO | `MINIO_ENDPOINT`+`MINIO_ACCESS_KEY`+`MINIO_SECRET_KEY`, `S3_ENDPOINT`+`AWS_ACCESS_KEY_ID`+`AWS_SECRET_ACCESS_KEY` |

`DATABASE_URL` 格式：`postgresql://user:password@host:port/database`

## Tab 结构

项目详情页 tab 顺序调整为：

```
Deployments | Pipeline | Logs | Database | Redis | Storage | Settings
```

新增路由：
- `/projects/:id/logs`
- `/projects/:id/database`
- `/projects/:id/redis`
- `/projects/:id/storage`

## 后端 API

### 连接管理

```
GET    /api/projects/:id/services              - 获取所有服务连接
POST   /api/projects/:id/services              - 添加连接 (DEVELOPER)
PATCH  /api/projects/:id/services/:sid         - 修改连接 (DEVELOPER)
DELETE /api/projects/:id/services/:sid         - 删除连接 (DEVELOPER)
POST   /api/projects/:id/services/detect       - 从环境变量自动识别
POST   /api/projects/:id/services/:sid/test    - 测试连接可用性
```

### Logs

```
GET    /api/projects/:id/logs                  - 获取历史日志（分页、搜索）
WebSocket: room "logs:{projectId}"             - 实时日志推送
```

查询参数：`?type=stdout|stderr&search=keyword&lines=100`

日志来源：PM2 日志文件 `~/.pm2/logs/{pm2Name}-out.log` 和 `{pm2Name}-error.log`。

### Database

```
GET    /api/projects/:id/database/tables                - 表列表
GET    /api/projects/:id/database/tables/:table         - 表结构和数据（分页）
POST   /api/projects/:id/database/query                 - 执行 SQL (DEVELOPER)
```

查询参数（表数据）：`?page=1&pageSize=50&sort=id&order=asc`

### Redis

```
GET    /api/projects/:id/redis/keys                     - key 列表（SCAN 分页）
GET    /api/projects/:id/redis/keys/detail?key=xxx       - key 详情（值、类型、TTL），key 名通过查询参数传递以避免 URL 编码问题
POST   /api/projects/:id/redis/keys                     - 创建 key (DEVELOPER)
PUT    /api/projects/:id/redis/keys/update?key=xxx      - 修改 key (DEVELOPER)
DELETE /api/projects/:id/redis/keys/delete?key=xxx      - 删除 key (DEVELOPER)
POST   /api/projects/:id/redis/command                  - 执行命令 (DEVELOPER)
```

查询参数（key 列表）：`?pattern=user:*&cursor=0&count=50`

### Storage

```
GET    /api/projects/:id/storage/buckets                       - bucket 列表
GET    /api/projects/:id/storage/buckets/:bucket               - 文件列表（分页）
GET    /api/projects/:id/storage/buckets/:bucket/download?key=xxx  - 下载文件，key 通过查询参数传递
POST   /api/projects/:id/storage/buckets/:bucket/upload            - 上传文件 (DEVELOPER)，multipart/form-data
DELETE /api/projects/:id/storage/buckets/:bucket/objects?key=xxx   - 删除文件 (DEVELOPER)
```

查询参数（文件列表）：`?prefix=images/&delimiter=/&maxKeys=100&continuationToken=xxx`

## 前端 UI

### Logs Tab
- 基于 xterm.js（复用现有 `DeployLogViewer` 组件）
- 终端风格深色背景
- 顶部工具栏：stdout/stderr 切换按钮、搜索框、Clear 按钮、暂停/继续按钮
- Socket.IO 实时推送，加入 `logs:{projectId}` room

### Database Tab
- 左侧面板：表列表（点击切换）
- 右侧主区域，三个子视图切换：
  - **Data**：数据表格，支持分页、排序
  - **Structure**：表结构（列名、类型、约束、索引）
  - **SQL Query**：代码编辑器 + 结果表格展示

### Redis Tab
- 左侧面板：key 列表，显示类型标签（string/hash/list/set/zset），顶部 pattern 过滤输入框，Add Key 和 CLI 按钮
- 右侧详情：key 名称、类型、TTL、大小，值展示（JSON 自动格式化），Edit/Delete 操作按钮
- CLI 模式：弹出命令行界面执行 Redis 命令

### Storage Tab
- 左侧面板：bucket 列表
- 右侧文件浏览器：面包屑路径导航，文件/文件夹列表（名称、大小、修改时间），Upload 按钮，每行 Download/Delete 操作

## 安全措施

### SQL 白名单
只允许执行以下 SQL 语句类型：
- `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `EXPLAIN`

禁止（后端校验，解析 SQL 语句前缀）：
- `DROP`, `TRUNCATE`, `ALTER`, `CREATE`, `GRANT`, `REVOKE`, `SET`, `COPY`

### Redis 命令黑名单
禁止执行：
- `FLUSHALL`, `FLUSHDB`, `CONFIG`, `SHUTDOWN`, `DEBUG`, `SLAVEOF`, `REPLICAOF`, `CLUSTER`
- `KEYS` 命令禁止，用 `SCAN` 代替

### 危险操作确认弹窗
以下操作触发前端确认对话框（需用户手动输入确认）：
- 执行 `DELETE` SQL 语句
- 删除 Redis key
- 删除 MinIO 文件
- 执行 Redis 写命令

### 权限控制
- 所有角色（含 VIEWER）：可查看数据（GET 请求）
- DEVELOPER 及以上：可执行写操作（POST/PUT/DELETE 请求）
- 复用现有 `@MinRole()` 装饰器

## 技术实现

### 后端模块

新增 5 个 NestJS 模块：

1. **ServicesModule** — 连接管理 CRUD、自动识别、连接测试
2. **LogsModule** — PM2 日志读取、WebSocket 实时推送
3. **DatabaseBrowserModule** — PostgreSQL 查询代理，SQL 校验
4. **RedisBrowserModule** — Redis 操作代理，命令校验
5. **StorageBrowserModule** — MinIO 文件操作代理

### 连接池管理

- 动态连接池，按 `ServiceConnection.id` 缓存
- 使用 `pg` 库连接 PostgreSQL（连接池 max 5）
- 使用 `ioredis` 连接 Redis
- 使用 `minio` SDK 连接 MinIO
- 空闲 5 分钟自动断开释放
- 连接池封装为 `ConnectionPoolService`，各模块共用

### Logs 实时推送

- 后端使用 Node.js `fs.watch` 或 `tail` 子进程监听 PM2 日志文件
- 通过现有 `DeployGateway`（Socket.IO）扩展，新增 `logs:{projectId}` room
- 前端订阅时开始 tail，取消订阅时停止
- 日志文件路径：`~/.pm2/logs/{project.pm2Name}-out.log` 和 `-error.log`

### 前端结构

新增页面：
- `frontend/src/app/projects/[id]/logs/page.tsx`
- `frontend/src/app/projects/[id]/database/page.tsx`
- `frontend/src/app/projects/[id]/redis/page.tsx`
- `frontend/src/app/projects/[id]/storage/page.tsx`

新增 hooks：
- `useServiceConnections(projectId)` — 连接管理
- `usePm2Logs(projectId)` — 实时日志（Socket.IO）
- `useDatabaseTables(projectId)` — 表列表
- `useTableData(projectId, table)` — 表数据
- `useRedisKeys(projectId, pattern)` — Redis key 列表
- `useRedisKeyDetail(projectId, key)` — Redis key 详情
- `useStorageBuckets(projectId)` — bucket 列表
- `useStorageObjects(projectId, bucket, prefix)` — 文件列表

新增依赖：
- `pg` — PostgreSQL 客户端（后端）
- `ioredis` — Redis 客户端（后端）
- `minio` — MinIO SDK（后端）

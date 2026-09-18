# 养词 · 后台管理（admin-web）

独立 PC 端后台，用于管理养词 App 的单词、用户、在线情况等。
技术栈：**Vue 3 + Vite + Element Plus + Pinia + Vue Router**（与小程序前端解耦）。

## 功能

| 模块 | 说明 |
|------|------|
| 数据概览 | 总用户 / 实时在线(WS) / DAU / 单词总数 / 对战场次 / 未结束房间；近 N 天新增用户柱状图（15s 自动刷新） |
| 单词管理 | 按词书筛选 + 关键词搜索 + 分页；新增 / 编辑 / 删除（删除会级联清掉用户卡牌，需二次确认） |
| 用户管理 | 搜索（用户名/昵称/openid/ID）+ 分页；详情抽屉（卡牌健康分布、等级分布、对战统计）；改昵称 / 改金币 / 设管理员 / 封禁 / 重置密码 |
| 在线统计 | 近 5 分钟活跃用户列表（是否对战中）+ 进行中的对战房间（10s 自动刷新） |
| 操作日志 | 所有高危写操作留痕：谁、何时、改了什么、来源 IP |

## 启动

```bash
# 1. 先启动后端（server-ts，端口 3000，需本机 MySQL）
cd ../server-ts
npx ts-node src/app.ts        # 或 npm run dev

# 2. 启动后台
cd ../admin-web
npm install
npm run dev                   # http://localhost:5175
```

> 开发环境通过 Vite 代理 `/api` → `http://localhost:3000`。
> 如需指向其它后端：`set VITE_API_TARGET=http://x.x.x.x:3000 && npm run dev`

生产打包：`npm run build`（产物在 `dist/`，是纯静态站点，扔到任意静态服务器 + 反代 `/api` 即可）。

## 首次使用：如何获得管理员权限

后台接口全部要求 `users.is_admin = 1`。**库里一个管理员都没有**时，
用你想提权的账号在登录页正常登录，系统会自动调用 `/api/admin/bootstrap`
把它设为管理员（该接口只在「无任何管理员」时可用，之后自动失效，防止越权提权）。

之后新增管理员：**用户管理** → 打开用户详情 → 勾选「设为管理员」→ 保存。

## 后端接口一览（`/api/admin/*`，均需管理员 token）

- `GET  /dashboard` 概览 · `GET /stats/trend?days=14` 趋势 · `GET /online` 在线明细
- `GET  /books` 词书下拉
- `GET|POST /words` · `PUT|DELETE /words/:id` 单词 CRUD
- `GET  /users` · `GET /users/:id` · `PUT /users/:id` · `POST /users/:id/reset-password`
- `GET  /logs` 操作日志
- `POST /bootstrap` 首个管理员初始化（**不需**管理员身份，仅需登录）

## 相关后端改动

- `server-ts/src/middleware/admin.ts`：管理员鉴权（验 token + 查库确认 `is_admin`/未封禁）
- `server-ts/src/middleware/auth.ts` / `utils/activity.ts`：任意请求写 `last_active_at`（60s 节流）
- `server-ts/src/db/init.ts`：`users` 加 `is_admin` / `is_banned` / `last_active_at`；新表 `admin_logs`
- `server-ts/scripts/_admin_e2e_test.cjs`：后台接口端到端回归（29 项断言）

## 注意

- 删除单词是**高危**操作：会连带删除所有用户已收服的该词卡牌与喂养日志，不可恢复。
- 后台的 BASE_URL 走相对路径 `/api`，因此不依赖 `utils/request.js` 里那个小程序用的地址。

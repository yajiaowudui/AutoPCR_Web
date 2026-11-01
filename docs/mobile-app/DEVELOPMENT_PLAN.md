# AutoPCR Android App 与 QQ 完全替代开发方案

> 状态：方案基线（待 P0 源码审计后冻结接口）
> 日期：2026-11-01
> 使用范围：个人使用；客户端仅 Android；目标是最终不再依赖 QQ / NapCat / OneBot / Hoshino 消息收发。

## 1. 项目目标与边界

### 1.1 最终目标

以 Android App 作为唯一日常操作入口，服务器持续运行 AutoPCR 日常任务、竞技场监控和公会相关任务。手机负责账号配置、任务控制、数据查看和接收通知。手机退出或锁屏后，服务器任务仍应持续运行。

“彻底替代 QQ”意味着：

- 不再通过 QQ 命令启动、配置、暂停或查询功能。
- 不再通过 QQ 群消息推送竞技场、公会、日常任务和异常通知。
- 不再把 NapCat、OneBot、Hoshino 作为运行必需依赖。
- 现有游戏 API、AutoPCR 业务逻辑、数据库和成熟算法尽量复用，不因更换交互入口而重写。
- 迁移完成后，QQ/Hoshino 只作为旧系统对照和回滚参考，之后可停用。

### 1.2 非目标

- 不开发 iOS、桌面客户端或多人 SaaS。
- 不建设公开用户注册、群管理、多租户权限系统。
- 不把游戏自动化任务迁移到手机本地运行。
- 不在第一阶段重写 AutoPCR 核心协议、竞技场算法或公会战业务算法。
- 不把 Android 推送当作任务调度器；任务调度必须在服务器。

## 2. 仓库职责与建议目录

当前工作区已确认存在两个独立 Git 仓库：

| 仓库 | 当前职责 | 本项目职责 |
|---|---|---|
| `AutoPCR_Web/` | React + Vite 网页前端；现有前端通过打包脚本部署到后端 | 产品入口与接口契约主文档；继续维护网页端，并为 Android 提供一致的 API/业务页面定义 |
| `HoshinoBot/` | Python 后端、AutoPCR 模块及多个 Hoshino 插件 | 现有业务逻辑来源；逐步抽离 QQ 事件适配层，提供独立服务/API |
| 新建 Android 仓库（建议 `AutoPCR_Android/`） | 当前尚不存在 | Kotlin + Jetpack Compose 原生 Android 客户端 |

### 2.1 文档归属

本方案放在 `AutoPCR_Web/docs/mobile-app/DEVELOPMENT_PLAN.md`，原因：该仓库是现有 AutoPCR Web 产品界面仓库，且 `MIGRATION.md` 已明确记录 Web 前端与 HoshinoBot 后端的部署关系。此文档是跨仓库的产品迁移方案，不表示 Android 客户端代码也放进 Web 仓库。

建议后续文档：

```text
AutoPCR_Web/docs/mobile-app/
├── DEVELOPMENT_PLAN.md       # 本方案：跨仓库总计划
├── API_CONTRACT.md           # 稳定后的 REST/WebSocket 契约
├── FEATURE_MATRIX.md         # QQ 旧命令 -> App 页面/API/验收映射
└── STATUS.md                 # 当前进度、阻塞、下一步

HoshinoBot/docs/mobile-migration/
├── LEGACY_INVENTORY.md       # 旧插件与业务入口盘点
└── EXTRACTION_NOTES.md       # 业务逻辑抽离记录（在 P0 后建立）

AutoPCR_Android/              # 新建独立仓库
└── app/                      # Kotlin / Jetpack Compose
```

### 2.2 分支策略

- `AutoPCR_Web`：从当前干净分支 `feature/show-stamina` 派生独立 `feature/android-api-contract` 或先建立专用开发分支；不得直接在 `main` 上开发。
- `HoshinoBot`：从当前干净分支 `master` 派生 `feature/standalone-app-service`；先只做审计和服务边界设计，禁止直接删除 QQ 适配层。
- `AutoPCR_Android`：独立仓库，使用 `main` + `feature/*`。
- 每个阶段只处理一个可验收子任务；跨仓库接口先定契约，再分别实现。

## 3. 现有代码资产与迁移范围

### 3.1 已确认的基础

- `AutoPCR_Web/MIGRATION.md` 已记录 React 前端与 `HoshinoBot/hoshino/modules/autopcr/` 后端模块的部署关系。
- `HoshinoBot/hoshino/modules/autopcr/` 已包含 AutoPCR 游戏客户端、账号管理、模块调度、HTTP Server 等核心代码。
- `HoshinoBot/hoshino/modules/kanna_connection_redive_2/` 已包含公会成员查询、考勤缓存、深域进度、助战及相关账号/数据库逻辑。
- `kanna_connection_redive_2/support_query/__init__.py` 中存在独立的 `公会成员管理` Service，默认关闭；命令包括 `更新公会数据`、`公会考勤表`、`查公会成员`、`清除公会绑定数据`。
- `kanna_connection_redive_2/attendance.py` 已有 `fetch_clan_attendance()`、`refresh_clan_attendance()`，复用已有游戏连接获取成员资料并保存考勤/练度数据。
- 同一插件还提供 `公会深域查询`、`公会box查询`、`上公会战支援` 等公会相关能力。
- `kanna_connection_redive_2/clanbattle/` 中的出刀监控会在公会成员管理服务启用时自动刷新成员缓存，说明公会考勤与会战监控存在业务联动。
- `HoshinoBot/hoshino/modules/pcrclanbattle/`、`clanbattle_rank/` 是独立模块；不能把所有公会功能都误认为属于 `kanna_connection_redive_2`。

以上是源码盘点线索，不代表已有适合 App 直接调用的完整 REST API。P0 必须逐项核实入口、依赖、数据库和测试。

### 3.2 完整迁移清单（以功能为单位）

| 功能域 | 现有来源/入口 | Android 目标页面或能力 | 优先级 |
|---|---|---|---|
| 账号绑定与账号列表 | `kanna_connection_redive_2` 账号绑定/数据库；AutoPCR `accountmgr.py` | 账号管理、登录状态、服务器/昵称、添加/删除/重新登录 | P0 |
| AutoPCR 日常 | `autopcr` 模块系统、`crons.py`、`modulemgr.py` | 任务开关、运行状态、执行记录、手动执行 | P0 |
| 竞技场监控 | `autopcr` `util/arena.py`、竞技场相关模块与服务端接口 | JJC/PJJC 状态、雷达、排名变化、被打记录、换防、暂停/恢复 | P0 |
| 竞技场策略与记录 | `pcrjjc_huannai2` 及 AutoPCR 竞技场工具 | 记录查看、策略配置、异常提示 | P1 |
| 公会成员查询 | `kanna_connection_redive_2/support_query` 的 `查公会成员` | 搜索公会、同名公会选择、成员列表和成员资料 | P1 |
| 公会成员缓存/考勤 | `公会成员管理` Service、`attendance.py`、`ClanAttendance` | 更新公会数据、查看考勤表、查看更新时间、清除缓存 | P1 |
| 公会深域进度 | `support_query` 的 `公会深域查询` | 按成员查看五属性深域进度/公主骑士等级 | P1 |
| 公会 BOX 查询 | `kanna_connection_redive_2/support_query` 的公会 BOX 查询 | 按角色/成员查询公会 BOX；需确认是否保留现有查询范围限制 | P1 |
| 公会助战管理 | `kanna_connection_redive_2` 的助战缓存、精准助战、换公会战支援 | 查看助战、刷新缓存、设置/撤下支援、显示 EX 配装结果 | P1 |
| 公会战出刀监控 | `kanna_connection_redive_2/clanbattle/`（自动报刀2）及其数据库 | 监控启停、当前战报、今日/昨日战报、个人战报、Boss/预约/挂树/SL/修正等 | P1 |
| 公会战排名 | `clanbattle_rank` | 公会名/会长名搜索、排名详情、赛季状态 | P2 |
| AutoPCR 原生公会工具 | `autopcr/server.py` 注册的 `公会支援`、`查公会深域`、`公会点赞` 等工具 | 按实际使用情况并入公会工具页，避免与 KCRR 重复实现 | P1/P2 |
| 通知 | 当前散落在 QQ `bot.send`、Hoshino 消息事件 | App 消息中心、Android 推送、通知偏好与已读状态 | P0 |

**公会功能的边界：** P1 先迁移个人账号可访问的成员查询、考勤、深域、BOX 和助战能力；公会战出刀监控属于完整公会业务，也纳入最终替代范围，但要独立做数据/状态机审计，不能只把 QQ 文本回复换成 App 文本。

## 4. 目标架构

```text
┌──────────────────────────────┐
│ Android App（Kotlin / Compose）│
│ 账号 / 日常 / 竞技场 / 公会     │
│ 消息中心 / 设置 / 手动操作      │
└──────────────┬───────────────┘
               │ HTTPS REST + WebSocket/SSE
               ▼
┌──────────────────────────────┐
│ 独立 App API / Auth 层         │
│ 登录、鉴权、请求校验、限流      │
│ 统一响应、审计日志、消息读取    │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ 业务服务层                     │
│ AutoPCR / Arena / Clan / Jobs │
│ Notification / Account        │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ 现有 Python 业务核心            │
│ autopcr + KCRR + clanbattle    │
│ 逐步剥离 Hoshino/OneBot 适配层  │
└──────────────┬───────────────┘
               ▼
       游戏 API / 数据库 / 定时任务

服务器事件 ──► 消息中心持久化 ──► Android 推送（FCM 或 ntfy）
```

### 4.1 核心原则

1. **服务器执行，手机控制。** 所有定时任务、竞技场轮询、公会监控和游戏 API 调用都在服务器执行。
2. **业务与消息渠道解耦。** 业务代码不再直接依赖 `bot.send()`；改为产生结构化业务事件，由通知服务决定写消息中心和推送。
3. **先抽服务，后移除 Hoshino。** 先让相同业务逻辑同时可由旧 QQ 适配层和新 App API 调用，验收后才关闭旧入口。
4. **单人使用仍需鉴权。** 个人版不等于无认证；不允许把管理 API 暴露成匿名公网接口。
5. **长任务异步化。** App 发起任务后返回 `job_id`，通过任务状态接口/WebSocket/SSE 查询进度，不能让 HTTP 请求一直挂起。

### 4.2 技术选型建议

| 层 | 建议 | 原因 |
|---|---|---|
| Android | Kotlin + Jetpack Compose | 仅 Android，原生通知、后台限制、权限与生命周期支持直接 |
| 本地状态 | Room（仅缓存必要数据）+ DataStore | 账号展示缓存、消息已读状态、客户端设置 |
| 网络 | Retrofit/OkHttp；WebSocket 或 SSE | REST 管理操作，实时状态/消息流 |
| 后端 | 优先复用现有 Python 运行环境，增加独立 App API 层 | 避免重复实现 AutoPCR 游戏会话；框架在 P0 审计后决定，不预设必须新建 FastAPI |
| 通知 | 消息中心为事实来源；先验证 ntfy，必要时再接 FCM | 推送可丢失/延迟，消息中心负责补取和去重 |
| 部署 | 现有服务器 Docker/反向代理体系 | 降低部署复杂度，API 与游戏任务进程分离或明确隔离 |

## 5. API 契约草案

以下是建议的资源与路由，不是声称当前代码已经存在这些接口。P0 需先检查 AutoPCR 现有 HTTP Server，能复用的就复用；缺失的再新增。统一前缀建议 `/api/v1`。

### 5.1 通用约定

- 所有接口 HTTPS；除健康检查外必须认证。
- 统一响应：`{ "ok": true, "data": ..., "request_id": "..." }`；错误返回稳定 `code`、用户可读 `message`。
- 分页列表使用 `items`、`next_cursor`；时间统一 ISO-8601 UTC，客户端按本地时区展示。
- 所有会改变游戏状态的操作支持 `Idempotency-Key`，避免重复点击导致重复执行。
- 长任务返回 `202 Accepted` + `job_id`；通过 `GET /jobs/{job_id}` 取状态。
- 账号密码、Token、游戏登录票据不回传给 App 日志或普通接口。

### 5.2 认证与账号

| 方法 | 路由 | 用途 |
|---|---|---|
| POST | `/auth/login` | App 登录，换取短期 access token |
| POST | `/auth/refresh` | 刷新 token |
| POST | `/auth/logout` | 撤销当前设备会话 |
| GET | `/accounts` | 账号列表与登录/运行状态 |
| POST | `/accounts` | 添加/绑定游戏账号（具体认证方式 P0 后确定） |
| DELETE | `/accounts/{account_id}` | 删除绑定 |
| POST | `/accounts/{account_id}/relogin` | 重新登录/恢复会话 |

### 5.3 日常、竞技场与任务

| 方法 | 路由 | 用途 |
|---|---|---|
| GET | `/daily/modules` | 日常模块及启用状态 |
| PATCH | `/daily/modules/{module_id}` | 开关日常模块 |
| POST | `/daily/run` | 手动执行日常，返回 job |
| GET | `/arena/status` | JJC/PJJC 监控状态 |
| GET/PATCH | `/arena/settings` | 读取/更新雷达、轮询、换防设置 |
| POST | `/arena/pause` | 暂停竞技场自动操作 |
| POST | `/arena/resume` | 恢复竞技场自动操作 |
| GET | `/arena/events` | 排名变化、被打记录、换防记录 |
| GET | `/jobs/{job_id}` | 长任务状态与结果 |

### 5.4 公会 API

| 方法 | 路由 | 用途 | 现有业务来源线索 |
|---|---|---|---|
| GET | `/clans/search?q=` | 按公会名搜索，支持同名候选 | `support_query` 的 `查公会成员` |
| GET | `/clans/{clan_id}/members` | 成员列表及基础资料 | `get_clan_members_info()` / `fetch_clan_attendance()` |
| POST | `/clans/{clan_id}/attendance/refresh` | 刷新考勤/练度缓存，返回 job | `refresh_clan_attendance()` |
| GET | `/clans/{clan_id}/attendance` | 考勤表、成员练度与更新时间 | `ClanAttendance` / DAL |
| DELETE | `/clans/{clan_id}/attendance` | 清除缓存，二次确认 | `清除公会绑定数据` |
| GET | `/clans/{clan_id}/talent-progress` | 成员深域进度 | `公会深域查询` |
| GET | `/clans/{clan_id}/box` | 公会 BOX 查询 | KCRR support query，需审计具体筛选能力 |
| GET | `/clans/{clan_id}/support-units` | 查看公会助战 | KCRR support query / AutoPCR 公会支援 |
| POST | `/clans/{clan_id}/support-units` | 设置/变更公会战支援 | KCRR `change_support_unit` |
| DELETE | `/clans/{clan_id}/support-units/{slot}` | 撤下支援（若现有业务支持） | P0 核实 |
| GET | `/clan-battle/status` | 会战阶段、Boss、监控状态 | `kanna_connection_redive_2/clanbattle` |
| POST | `/clan-battle/monitor/start` | 启动出刀监控 | 自动报刀2 |
| POST | `/clan-battle/monitor/stop` | 停止出刀监控 | 自动报刀2 |
| GET | `/clan-battle/reports` | 当前/今日/昨日/个人战报 | 自动报刀2 |
| GET | `/clan-battle/reservations` | 预约列表 | 自动报刀2 |
| POST/DELETE | `/clan-battle/reservations` | 创建/取消预约 | 自动报刀2 |
| GET | `/clan-battle/rankings` | 公会战排名查询 | `clanbattle_rank` |

### 5.5 通知与实时状态

| 方法 | 路由 | 用途 |
|---|---|---|
| GET | `/notifications` | 消息中心列表，支持游标分页 |
| POST | `/notifications/{id}/read` | 标记已读 |
| POST | `/notifications/read-all` | 全部已读 |
| GET | `/notifications/stream` | SSE 实时事件流；若运行环境不适合则采用 WebSocket |
| GET/PUT | `/notification-settings` | 通知类别、免打扰和推送目标设置 |

## 6. 消息事件模型

业务模块只产生事件，不直接向 QQ 或 Android 发消息。建议事件字段：

```json
{
  "event_id": "uuid",
  "event_type": "arena.rank_changed",
  "severity": "info",
  "occurred_at": "2026-11-01T10:00:00Z",
  "account_id": "account-1",
  "title": "竞技场排名变化",
  "summary": "排名由 35 变为 42",
  "payload": {},
  "dedupe_key": "arena:account-1:jjc:rank:42"
}
```

首批事件类型：

- `daily.started` / `daily.completed` / `daily.failed`
- `arena.rank_changed` / `arena.attacked` / `arena.defense_changed` / `arena.monitor_error`
- `clan.attendance_refreshed` / `clan.member_query_failed`
- `clan_battle.monitor_started` / `clan_battle.report_updated` / `clan_battle.boss_changed` / `clan_battle.monitor_error`
- `account.login_expired` / `account.relogin_failed`
- `system.job_failed` / `system.service_unavailable`

通知服务需要持久化、去重、重试和保留期限；推送服务失败不能影响游戏任务本身。App 启动时必须从消息中心补拉未读消息。

## 7. 开发阶段、任务与验收标准

### P0：源码审计与迁移基线

**任务**

1. 对 `AutoPCR_Web`、`HoshinoBot/autopcr`、`kanna_connection_redive_2`、`pcrclanbattle`、`clanbattle_rank` 做功能入口和依赖盘点。
2. 对每条 QQ 命令记录：处理函数、业务函数、账号来源、数据库表、外部 API、定时任务、消息发送点、现有测试。
3. 检查 AutoPCR 现有 HTTP Server：认证方式、路由、账号隔离、长任务、并发控制、错误格式。
4. 重点审计公会成员查询的多账号遍历、同名公会选择、`ClanAttendance` 缓存键、群号耦合、清缓存影响范围。
5. 形成 `FEATURE_MATRIX.md`、`API_CONTRACT.md` 初稿和迁移风险清单。

**验收**

- 目标范围内所有用户实际使用的 QQ 命令都有映射，不存在“只迁移了查询而遗漏更新/监控/通知”的盲区。
- 明确区分 `kanna_connection_redive_2`、`pcrclanbattle`、`clanbattle_rank` 与 AutoPCR 原生工具。
- 每个功能都标注可复用代码、需要解耦代码、缺少测试和阻塞项。
- 未修改业务代码，不改变现有运行行为。

### P1：独立 App API 与认证

**任务**

1. 建立独立 App API 入口，先实现健康检查、登录、刷新/撤销会话和账号列表。
2. 建立单用户认证、设备会话、密钥轮换和 HTTPS 部署方案。
3. 将 Hoshino 事件参数适配与业务函数拆开；同一业务函数可被旧 QQ 入口和新 API 调用。
4. 建立异步任务表/任务管理器，支持状态、进度、取消（仅限安全可取消任务）和结果。

**验收**

- 未认证请求无法访问任何账号/游戏操作接口。
- 登录失败、过期 token、撤销会话均有明确错误。
- API 进程重启后，任务状态和关键执行记录可恢复或明确标记中断。
- 现有 QQ 功能仍可用；API 的调用不会绕过账号锁、会话锁和限流。

### P2：消息中心与推送

**任务**

1. 建立统一业务事件接口和持久化消息中心。
2. 将 AutoPCR 日常、竞技场和账号错误通知从 `bot.send()` 迁移为事件。
3. 接入 ntfy 做 Android 推送试验；验证自建服务、鉴权、断线补取和重复推送处理。
4. 统一消息类别、严重等级、去重键、已读状态和推送偏好。

**验收**

- 关闭 QQ/NapCat 后，服务器仍可生成并保存所有测试事件。
- 手机离线期间产生的消息，在重新联网后可从消息中心补取。
- 同一事件重试不会无限重复入库/重复提醒。
- 推送服务不可用时，任务继续运行且消息不丢失。

### P3：日常与竞技场迁移

**任务**

1. 先迁移日常模块开关、手动运行、结果和日志。
2. 再迁移 JJC/PJJC 监控状态、雷达设置、排名变化、被打记录、换防控制、暂停/恢复。
3. 逐项把 QQ 命令改成业务服务调用；保留旧入口作为短期兼容适配器。

**验收**

- App 与旧 QQ 入口对同一账号读取到一致的模块配置和竞技场状态。
- App 操作后服务器状态可持久化，重启后不意外丢失。
- 排名变化、被打和换防事件均进入消息中心。
- 保留现有竞技场查询冷却、并发锁、暂停保护和失败恢复行为。
- 不因 App 轮询或重试增加游戏 API 请求频率。

### P4：公会功能迁移（新增纳入范围）

**任务**

1. 迁移公会搜索和成员列表：覆盖 `查公会成员 公会名` 的同名候选选择、超时和失败处理。
2. 迁移公会成员数据更新、考勤/练度表、更新时间和清缓存。
3. 迁移公会深域进度和公会 BOX 查询。
4. 迁移助战查询、缓存刷新、支援更换及 EX 配装保护/结果。
5. 独立迁移会战出刀监控：启动/停止、战报、预约、Boss 状态、挂树/SL、刀数修正等实际启用能力。
6. 迁移公会战排名查询。
7. 移除业务函数对 `ev.group_id`、`ev.user_id`、`bot.send()` 的直接依赖；个人版改用 App 用户、游戏账号和明确的公会绑定关系。

**验收**

- App 可完成公会名搜索、同名公会选择、成员列表查看，不需要 QQ。
- 更新公会数据后，成员数、基础资料、深域进度、练度和更新时间与游戏接口/旧系统对照一致。
- 缓存按明确的 `account_id + clan_id` 或经审计后确认的稳定键隔离；不得继续把 QQ 群号作为唯一业务归属。
- 清除缓存必须有二次确认，且只影响当前选择的账号/公会。
- 会战监控在 App 中启停后，服务器任务状态与旧版一致；重复点击不会重复启动任务。
- 助战更换必须保留账号授权、EX 保护、装备不够时停止、操作后回读校验和异常恢复机制。
- QQ/NapCat 关闭时，以上公会功能仍可独立使用。

### P5：Android App 开发与体验完善

**建议页面**

1. 登录/设备管理。
2. 首页：服务状态、当前账号、日常执行摘要、竞技场摘要、公会/会战摘要。
3. 账号管理。
4. 日常任务。
5. 竞技场：JJC/PJJC 分页、监控/雷达/换防、事件记录。
6. 公会：公会选择、成员、考勤、深域、BOX、助战。
7. 公会战：监控、战报、预约、Boss 状态、排名。
8. 消息中心：分类、未读、详情、已读。
9. 设置：推送、免打扰、服务器连接、日志导出。

**验收**

- Android 真机可安装、登录、刷新 token、退出登录。
- App 锁屏、被系统回收或手动划掉后，服务器任务仍继续运行。
- App 再次打开后能恢复服务器状态和未读消息。
- 推送点击可跳转到对应事件详情。
- 网络断开、服务器离线、接口超时均有明确提示和安全重试，不重复触发写操作。

### P6：完全替代与下线 QQ

**任务**

1. 建立旧 QQ 功能与 App 功能逐项对照表，连续试运行。
2. 停止新增 QQ 命令功能；观察期内旧入口只读或兼容。
3. 关闭 NapCat/OneBot/Hoshino 消息适配，确认无业务模块再依赖消息事件。
4. 清理部署、监控、备份和恢复文档中的 QQ 必需步骤。

**验收**

- 目标功能清单全部标记为 App 已验收。
- 服务器冷启动后无需启动 NapCat/Hoshino 消息端，日常、竞技场、公会任务均可运行。
- Android App 能完成全部日常操作和查询，所有通知可从消息中心补取。
- 连续运行观察期内无因移除 QQ 导致的任务遗漏、状态丢失或通知丢失。
- 具备数据库备份、服务回滚和重新启用旧入口的应急说明；完成验收后再正式停用旧 QQ 端。

## 8. 安全、可靠性与运维要求

- App API 只允许 HTTPS；管理端口不直接暴露，优先经现有反向代理入口。
- 使用高熵随机密钥；密码只存哈希，游戏凭据使用服务器侧加密存储；日志必须脱敏。
- 单用户也要有设备会话撤销、token 过期、登录失败限速和备份恢复。
- 写操作需要幂等键、账号级互斥锁和服务端二次校验。
- 推送内容避免包含密码、完整 UID、敏感票据；通知点击后再通过认证 API 拉取详情。
- 服务健康、任务队列积压、最近成功执行时间、游戏登录失效和推送失败均应可观测。
- 数据库迁移必须备份、可重复执行或具备明确回滚脚本。

## 9. 风险与待确认事项

| 风险/未知 | 处理方式 |
|---|---|
| AutoPCR 现有 HTTP Server 是否已具备足够的独立 API、认证和任务状态能力 | P0 检查路由、鉴权、会话和后台任务；不凭文件名推断能力 |
| KCRR 公会考勤以群号作为缓存隔离键 | 设计账号/公会维度的数据归属迁移；先做数据备份与兼容读取 |
| 公会搜索依赖多个绑定账号逐一登录查询 | 抽成可取消后台任务，限制并发与频率，展示每个账号的查询结果/错误 |
| 会战监控与 QQ 群上下文耦合 | 把“群”概念替换成用户配置的公会工作区/监控实例，先明确一个账号对应一个监控实例的规则 |
| 同一游戏账号被日常、竞技场、公会任务并发登录 | 复用现有 ClientPool/账号锁，P0 核对跨模块锁是否覆盖所有调用路径 |
| Android 推送可能延迟或丢失 | 消息中心持久化为准，推送仅作提醒，启动/恢复时补拉 |
| 手机后台限制 | 不在手机执行持续任务；Android 只做推送展示与用户操作 |

## 10. 下一步：只启动 P0，不提前改业务代码

首个开发任务建议命名为 `P0-01：AutoPCR Android 迁移源码盘点`，输出：

1. `FEATURE_MATRIX.md`：全部目标功能、原 QQ 命令、源文件/函数、数据表、通知点、App 页面和验收用例。
2. `API_CONTRACT.md`：现有接口复用表、需要新增的 API、请求/响应样例、鉴权方案。
3. `MIGRATION_RISKS.md`：群号耦合、账号锁、缓存归属、任务生命周期和通知缺口。
4. `STATUS.md`：审计结论、阻塞项和唯一下一任务。

P0 完成前不创建 Android 页面、不重构竞技场算法、不迁移数据库、不删除任何 QQ/Hoshino 入口。

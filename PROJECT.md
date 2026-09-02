# whereisit · 项目主文档(跨会话锚点)

> 本文档是把「物品在哪」构想敲定为工程方向的**正式记录**。原始产品构想见同目录 [`whereisit.md`](whereisit.md)。
> 未来任何会话(人或 AI)继续本项目,请先读本文件 + whereisit.md。

## 一、这是什么

个人向的**物品位置记录 / 搜索 / 更新应用**:
- 物品位置 = 逐层嵌套的"文件夹路径",如 `卧室 > 衣柜 > 上排左格`。
- 空间(spaces)是统一节点(房间/衣柜/抽屉/盒子都同一类),可多棵根(多场景),可套娃(一棵树嵌进另一棵)。

**核心数据洞察**:物品拆成两层——
- **种类 item_defs**("HDMI 线")+ 别名 item_aliases;
- **存在 item_lots**("抽屉 A2 里有 3 条",含 qty 与状态)。
由此自然支持:同一物品出现在多处、数件、存在性查找、借出/用尽。

## 二、已敲定方向(2026-09-02 用户确认)

| 维度 | 决定 |
|---|---|
| 技术栈 | Python **FastAPI**(无 ORM,stdlib sqlite3 + Pydantic v2)+ **React(Vite)SPA** + **SQLite 单文件** |
| Python 环境 | **conda 新建虚拟环境 `whereisit`(Python 3.12)**,全部依赖局部装,不碰其它环境 |
| 1.0 范围 | 核心先行:空间树 → 登记/改位置 → 精确/模糊/类别/存在性搜索 → 中英双语界面 → 模块化预留 |
| LLM 解析 | 放 **1.x(M6)**:读自然语言/照片抽场景结构。预留 provider-agnostic 客户端 + 封闭 type_tag 词表 + Fernet 加密 secrets + dry-run 人工确认 |
| 运行形态 | **局域网多设备**:PC 本地服务,手机/平板浏览器经 LAN 访问同一库;可选访问令牌 |
| 生产部署 | FastAPI **单端口托管构建后的 SPA**,绑定 `0.0.0.0:8080`,无 CORS |
| 界面 | 中英双语切换;**Apple 极简 + 精密秩序感**(设计理念见 plan 文件第五节),路径用等宽字体渲染成 `~/卧室/衣柜/上排左格`;支持把整块场景**拖进另一场景当子空间**(@dnd-kit) |
| 检索预留 | `SearchProvider` 协议 seam → 未来 sqlite-vec 向量搜索注册新 provider,调用方零改动 |
| 跨平台(未来) | Windows=PyWebview 包 FastAPI+SPA(最省);Android=Capacitor 复用 SPA + **客户端侧 SQLite(同 DDL/契约)**,Python 不上机 |
| 代码位置 | 本仓库根目录 `D:\vibecoding\whereisit`,现有 `backend/`、`frontend/` 尚未创建 |

## 三、里程碑(M0–M5 = 1.0 核心;M6=1.x;M7=跨平台)

| 里程碑 | 内容 | 状态 |
|---|---|---|
| **M0 脚手架** | git init;目录结构;FastAPI health;Vite+Tailwind+i18n;SQLite 打开+pragma;迁移执行器 + `001_initial.sql` | ✅ 完成(commit e58e992,4 测试通过) |
| **M1 核心浏览** | spaces 树 CRUD / GET tree / move(服务端防成环)/ delete;前端嵌套树 + breadcrumb | ✅ 完成(8+4 测试通过,含新建空间 UI) |
| **M2 登记/存储** | defs+lots+attrs 登记(update≈re-register);手动表单 + 位置选择器;拖拽嵌套基础 | 待开始 |
| **M3 搜索** | search seam + FTS5 trigram + ⌘K 面板 + 精确/模糊/类别/存在性;**先做 CJK 短词 spike** | 待开始 |
| **M4 打磨** | merge-defs 合并、status(借出/用尽)、删除/移动加固、分类管理、最近操作 undo | 待开始 |
| **M5 设置+LAN+视觉定稿** | 设置 UI、语言切换、访问令牌、单端口托管 SPA、导出/导入备份;`frontend-design` skill 出设计令牌与 Apple 审美打磨 | 待开始 |
| **M6 LLM 结构/照片解析** | 依赖 M1+M5 secrets;provider 客户端 + system prompts + 结构化输出 + 置信度 + dry-run/apply | 1.x,可 M1 后并行 |
| **M7 Windows/Android** | 依赖 M5;实施前评估 | 未来 |

依赖主线:M1→M2→M3→M4→M5(串行);M6 与 M1 后可并行。

## 四、关键决策速览(实现细节依此展开)

- **spaces**:自引用树,`parent_id NULL`=根,`type_tag` 标明类型,`layout_json` 只存描述性结构提示(非权威几何,真实抽屉仍是 spaces 行)。
- **attrs**:类型化 EAV(`entity_type IN(space,def,lot)` + `attr_key` + `value_type(text/int/real/bool/enum/date)` + 类型化值列),用于**属性检索**,可建索引、可范围过滤。
- **categories**:分类小树(同 spaces 邻接形态)。
- **settings**:UI 偏好/语言/令牌哈希; **secrets**:LLM Key 等,Fernet 加密,对外只返回掩码。
- **检索**:FTS5 **外部内容 + trigram + AFTER INSERT/UPDATE/DELETE 触发器**维护;中文 ≥3 字走 FTS,**≤2 字(钥匙/抽屉)走规范化 LIKE/前缀兜底**;需在 M3 先 spike 验证。
- **写入规范化**:所有 name/attr_key 落库前 NFKC+casefold+半角转全角。
- **迁移**:手写 `NNN_*.sql` + `schema_migrations(version)` 启动按序执行;纯 DDL 供移动端原样复用。
- **API 信封**:`{"v":1,"data":…}` + `GET /api/schema-version`,字段只增不改(为 Capacitor 复用铺路)。
- **SQLite pragma**:`journal_mode=WAL`、`foreign_keys=ON`、`synchronous=NORMAL`、`busy_timeout=5000`。
- **视觉基调**:克制极简;暖纸白浅色 + 深墨文字(配深色主题);**单一**克制强调色(深青/琥珀候选);正文 CJK 用 PingFang SC/Noto Sans SC,拉丁用有性格简洁无衬线,**不用 Inter**;路径/编号用精致等宽。详细见计划文件"设计理念"节。
- **前端工程**:TanStack Query(服务端数据)+ Zustand(临时 UI)+ @dnd-kit(PointerSensor 统一鼠标+触屏);i18n 用 react-i18next,zh-Hans + en。

## 五、目录布局与运行约定

```
D:\vibecoding\whereisit\
  whereisit.md           # 产品原始构想(保留,勿删)
  PROJECT.md             # 本文件:方向/里程碑/决策锚点
  backend/
    app/
      main.py            # FastAPI + lifespan(跑迁移) + SPA 静态托管
      core/              # config / settings / SecretsVault / LAN 令牌
      db/                # engine(pragma)、migrations、schema/001_initial.sql
      domains/
        spaces/ items/ categories/ search/ settings/ parse/ transfer/
      data/              # 运行生成 whereisit.db + secret.key(不入库)
  frontend/
    src/views,components,stores,i18n
```

- Python:激活 conda env `whereisit` 后在 `backend/` 装依赖(局部)。
- 开发联调:后端 `uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload`;前端 `vite` 把 `/api` 代理到 8080;生产 `vite build` 由 FastAPI 托管。
- 测试:后端 pytest + httpx TestClient + 临时 SQLite(每测先跑迁移);前端 Vitest;复杂 UI 用 webapp-testing skill 走金路径。
- **验收即"可用自测"**:手机连同一局域网访问 `http://<PC-IP>:8080`,完成一次"登记→找回→改位置"。

## 六、相关记忆位置(供 Claude 自动延续)

Claude 的跨会话记忆存于 `C:\Users\WIN10\.claude\projects\D--vibecoding-whereisit\memory\`(索引 `MEMORY.md`;含用户画像、项目方向)。本 `PROJECT.md` 是人类/冷启动锚点,两份内容一致,改动时保持同步。

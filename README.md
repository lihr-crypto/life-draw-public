# 生活抽签 Life Draw

两个人各抽一张，再一起选一件新鲜事。

本期实现每日新鲜事与灵感库，采用封缄信封、暖白与赤陶色、微错位纸条的视觉。两部手机使用同一服务端状态；候选内容在双方揭晓前保持隐藏。

## 本地启动

需要 Node >=22.13，推荐 Node 24。使用 Sites Vinext starter、React 和本地 D1；无需创建云端项目或填写外部数据库密钥。

```sh
npm run install:ci
npm run db:migrate:local
npm run dev -- --port 5273 --hostname 127.0.0.1
```

打开 <http://127.0.0.1:5273/>。新克隆默认采用 `portable` profile，保留 starter 的构建与身份集成。开发数据位于忽略目录 `.wrangler/state/v3/`，停止、重启服务会保留数据。清除浏览器 Cookie 会丢失本地设备身份；导出的灵感 JSON 不包含可恢复成员身份的凭据。

手动双人检查可以使用 Chrome 普通窗口与无痕窗口。第一个身份创建空间、生成邀请链接；第二个身份打开链接加入。两者必须使用同一个 origin（不要混用 `localhost` 和 `127.0.0.1`）。每个窗口持有独立 HttpOnly 设备身份。

该身份仅供 loopback 开发，线上保留 Sites 可信 ChatGPT 身份路径。本地地址不代表已支持两部手机通过互联网使用。`npm run build` 检查生产构建；`npm start -- --port 5273` 用 Wrangler 本地启动构建产物，不提供开发设备身份，不能代替双人开发验证。

## 本地 D1 迁移

schema 在 `db/schema.ts`，已生成的 SQL 与顺序在 `drizzle/`。修改 schema 后运行 `npm run db:generate`，检查新迁移，再停止预览并运行 `npm run db:migrate:local`。

- 新库按顺序初始化，迁移记录和 SQL 在同一 D1 batch 中提交，失败整批回滚。
- 已迁移数据库只执行未应用部分，重复运行无操作；已应用 SQL 的 SHA-256 不匹配时停止。不要修改已应用的迁移文件。
- 早期直接执行过 `0000_blushing_emma_frost.sql` 的本地数据库，在全部初始表与索引匹配后只补迁移记录，保留原数据。结构不匹配时停止，不重放建表或自动修复数据。
- 命令固定连接本地 D1，使用 `wrangler.local.json` 中与 Vite 相同的开发 binding/占位 database ID，不接受远端参数。不要改为生产数据库 ID，也不要混用 Wrangler 的 `d1 migrations apply` 与本项目迁移记录。

对已有数据库操作前先停止服务并备份 `.wrangler/state/`，保留可能存在的 SQLite WAL 文件。不要为重新初始化删除原数据库。迁移脚本不会自动备份；`npm run test:migrations` 使用临时内存 D1，检查新库、旧结构、重复执行、内容校验和失败回滚，不操作现有数据。

## 灵感与两人流程

创建空间时附带 23 条原创系统灵感，默认在备用区。打开右上角灯泡进入灵感库，至少启用两条内容后才能抽签。支持手动输入、每行一条批量添加、JSON 导入和导出。可抽池和备用池每条灵感均可编辑、保存或取消，也可确认后删除；本轮占用条目暂时锁定。删除后不再参与抽签或灵感导出，已有抽签记录保留。备用池支持通过“批量启用”勾选或全选后启用；待核对内容须先完成核对。两池列表不显示来源和备注，导出仍保留。

可抽、备用、待核对和已完成栏目均可独立收起/展开，标题和数量始终可见。收起长列表后可更快查看后面的栏目，列表刷新不会重置本次打开期间的折叠状态。

导入支持顶层 `items` 数组，也兼容本空间导出。下面是可移植的合成样例：

```json
{
  "items": [
    { "sourceId": "example-1", "text": "一起观察今天的云" },
    {
      "sourceId": "example-2",
      "text": null,
      "tentativeText": "需要核对的合成词",
      "readingStatus": "needs_confirmation"
    }
  ]
}
```

导入默认全部备用；相同 `sourceId` 重复导入幂等，不合并来源不同的同词纸条。待核对文字或用途标记必须明确确认后才能启用。导出只含灵感数据，不含会话或配对凭据；真实导出和原素材保留在忽略目录。

每人抽一张，等待时响应与页面均不包含词；双方抽好后点击「一起拆开」，再点选纸条并邀请对方；对方点击「我也选这一张」后才共同选定。两端播放收拢动画，最后只显示所选一张卡片。最终选择同步到两端，「完成了」是单独一步。未选纸条次日回池；右上角更多菜单中的「取消本轮」仍需明确确认。等待时「稍后继续」和刷新都保留本轮。

揭晓后可选择「重新抽取」；一人邀请、另一人同意后，旧卡回池并盲抽一组新的信，再一起拆开。需至少两条其他可用灵感，不足时保留原卡。邀请可以撤回或拒绝；刷新保留待回应状态，过期的重复操作不会影响新邀请。字体采用随站点提供的 Noto Serif SC Regular，见 `public/fonts/OFL.txt`，无需手机安装字体或访问外部字体服务。

## 验证

```sh
npm test
npm run typecheck
npm run test:migrations
npm run build
```

另开终端保持开发预览运行后执行 `npm run test:integration`，默认连接 5273，也可传入 loopback URL：

```sh
npm run test:integration -- http://127.0.0.1:5273
```

可选双浏览器检查需要 Playwright 和 Chrome。已有可解析的 `playwright` 包时直接运行 `npm run test:browser`；否则可用 `npm install --no-save --package-lock=false playwright` 临时安装 QA 依赖，或设置 `PLAYWRIGHT_MODULE` 指向主机已有的 Playwright 模块绝对路径。可通过 `PLAYWRIGHT_CHANNEL` 选择已安装的浏览器通道，默认 `chrome`。

```sh
npm run test:browser -- http://127.0.0.1:5273
```

集成与浏览器脚本只访问 loopback，创建各自隔离的合成空间，不清空原库；多次运行会留下 QA 空间。浏览器脚本覆盖配对提示清理、导入与失败草稿、盲抽与刷新、同步揭晓和完成、取消确认，以及 390/320px、长句、模拟 200% 文字和减少动态效果。实际截图与 JSON 结果写入忽略目录 `.local-reference/`，不保存测试身份。

自动检查、本机双浏览器、云端与真机证据分别记录。文字放大模拟不等于 iOS 系统字号验收；移动网络、真机触摸或 PWA 安装需要独立验收。站点通过 Sites 私有发布，需使用具有访问权限的 ChatGPT 账号登录；站点访问权限和应用内两人配对分别校验。发布记录以 Sites 的部署结果为准。

行为与接口见 [实施文档](docs/IMPLEMENTATION.md)，开发指引见 [交接记录](docs/HANDOFF.md)，提交与 PR 流程见 [GITHUB_WORKFLOW.md](GITHUB_WORKFLOW.md)，视觉基线见 [字体与动效接受稿](docs/design/accepted-motion-ui.png)。

## 私有站点

[生活抽签](https://life-draw.example.com)。站点 ID 记录在 `.openai/hosting.json`，后续复用该项目。默认仅拥有者可访问；另一位成员需先获得站点访问权限，再使用应用的一次性邀请链接配对。不要为绕过权限检查而开放匿名身份。

发布使用 Sites 构建、源码同步与版本部署流程，云端 D1 迁移由平台在 Worker 上传前执行。云端库与本机 `.wrangler/state/` 独立，不上传本地数据库、照片或私人转录。

> **占位符说明**：文档、清单和代码里的 `dashboard.example.com`、`travel.example.com`、`dashboard.example.invalid`、`appgprj_REPLACE_WITH_YOUR_PROJECT_ID` 都是示例值。部署前请换成你自己的公开域名和项目 ID；`dashboard.example.com/app-icons/` 指的是你自己部署的公开工作台（见 kindle-mobile-cloud 的 `public/app-icons/`）。

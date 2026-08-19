# dsh-plugin-scorecard

> DSH 插件体检评分卡：质量与安全审计、榜单与搜索。Quality & security scorecard, rankings and search for the dsh-plugin ecosystem.

一个 **Cordis 插件**，把「哪些插件值得装、哪个有风险」变成可执行的评分与报告：
- **plugin_sync_catalog** 同步 GitHub `dsh-plugin` topic 目录（star 排序，可配上限）
- **plugin_audit <名称>** 对单个插件出体检报告：0-100 分、A/B/C/D 等级、信号明细、证据链；高危安装脚本**一票否决**（🚨 封顶 30 分）
- **plugin_top** 榜单（按评分 / star / 最近更新）
- **plugin_search <关键词>** 语义搜索目录
- **plugin_history <名称>** 历史评分曲线（时间/分数/等级、趋势方向）

## 评分模型

| 维度 | 满分 | 说明 |
|---|---|---|
| 维护活跃度 | 30 | 最近 push、star 量、是否归档 |
| 文档质量 | 25 | README、描述、许可证、标签 |
| npm 可装性 | 15 | npm 包存在性、更新度、周下载 |
| 安全 | 30 | 安装脚本高危模式（curl|sh、/dev/tcp、base64 -d、iex…）、外部主机回连 |

等级：A ≥80 · B ≥60 · C ≥40 · D <40。命中高危模式 → 封顶 30 分 + 🚨 不推荐。

## 安装

```bash
dsh plugin add dsh-plugin-scorecard
```

或编辑 profile 的组合：`cordis.patch.yml` 已内置 `insert` 条目（id: `dsh-plugin-scorecard`）。

## 配置（可选）

| 字段 | 默认 | 说明 |
|---|---|---|
| githubToken | "" | GitHub Token，提升 API 限额（无 Token 时 60 次/小时） |
| securityScan | true | 是否扫描安装脚本 |
| cacheTtlMs | 900000 | 目录缓存 TTL（含工作区文件缓存） |
| catalogFile | `.dsh/scorecard-catalog.json` | 目录持久化文件（会话工作区内） |
| historyFile | `.dsh/scorecard-history.json` | 评分历史文件（会话工作区内） |
| historyMaxEntries | 100 | 历史快照条数上限 |
| maxCatalogSize | 200 | 每次同步的仓库数上限 |

## 开发

```bash
node --check lib/index.js
node test/scorer.test.mjs   # 主模块方式（沙箱里勿用 node --test）
node test/format.test.mjs
```

## 路线图

- v0.2 ✅：目录持久化（JSON 缓存）+ 历史评分曲线（plugin_history）
- v0.3：Web 设置页榜单（ui-settings-plugins 扩展点）+ 开放数据导出 JSON
- v0.4：企业审计报告导出 / 私有化

## License

MIT

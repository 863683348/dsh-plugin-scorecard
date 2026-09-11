# dsh-plugin-scorecard 路线图（Roadmap）

> 基线：**v0.1.0**（本地源码，未发布 npm）
> 范围：接下来 5 个版本 **v0.2.0 → v0.6.0**
> 说明：延续 README 已有路线图（v0.2/v0.3/v0.4），扩展为 5 个版本；v0.2 按原路线图落地。

## 版本总览

| 版本 | 主题 | 关键交付 |
|---|---|---|
| v0.2.0 | 目录持久化 + 历史评分 | JSON 缓存目录；`plugin_history` 快照评分与趋势曲线 |
| v0.3.0 | 增量同步 + 数据开放 | 增量目录同步；开放数据 JSON 导出 |
| v0.4.0 | 企业审计 | 完整审计报告导出（md/csv）；私有目录支持 |
| v0.5.0 | 供应链 + 预警 | 依赖树供应链扫描；评分下滑趋势预警 |
| v0.6.0 | 质量门 + 数据融合 | CI 质量门（低于阈值建议拦截）；awesome + FindHarness + npm 多源融合 |

## v0.2.0（下一个版本）— 目录持久化 + 历史评分曲线

### 新增能力
- **目录持久化**：
  - 同步结果缓存到工作区文件（`.dsh/scorecard-catalog.json`，走 `ctx.fs` + containment 校验）
  - `plugin_sync_catalog` 命中缓存时跳过重复同步（TTL 可配，默认沿用 `cacheTtlMs`）
- **历史评分曲线**：
  - 每次 `plugin_audit` 的结果按时间快照追加到历史文件（`.dsh/scorecard-history.json`）
  - 新增 `plugin_history <名称>`：输出该插件评分时间线（时间/分数/等级）、趋势方向（↑↓→）、最新对比

### 实现位置
- `lib/scoring.js`：新增历史快照聚合、趋势判定纯函数
- `lib/storage.js`（若存在）或新增 `lib/history.js`：JSON 读写（纯函数 + fs 注入）
- `lib/index.js`：注册 `plugin_history` 动作；`plugin_audit` 追加快照

### 验收标准
- [ ] `node --check` 通过
- [ ] 新增单测 ≥ 6 个（快照追加、去重、趋势判定、缓存命中/过期、边界）
- [ ] 原有 4 个工具单测全绿
- [ ] README 更新（新配置 `historyFile` / `historyMaxEntries`、新动作说明）
- [ ] vertical-toolkits dump-config 正常；本地冒烟：sync → audit → history

## v0.3.0 ✅ 已完成 — 增量同步 + 数据开放

- `plugin_sync_catalog` 支持增量（仅拉取变更仓库）；`plugin_export` 导出目录/评分 JSON（开放数据）

## v0.4.0 — 企业审计

- `plugin_report`：完整审计报告导出（md/csv：评分明细、证据链、安全信号）
- 私有目录支持：配置本地目录清单（不依赖 GitHub topic）

## v0.5.0 — 供应链 + 预警

- 依赖树扫描：读取插件 package.json 依赖 → 风险信号（未维护/高危模式）
- `plugin_history` 增加趋势预警（连续下滑 N 次 → 提示复查）

## v0.6.0 — 质量门 + 数据融合

- CI 质量门：`plugin_audit` 分数低于阈值时给出"建议拦截"结论（供安装前决策）
- 多数据源融合：awesome 目录 + FindHarness + npm 元数据合并评分

## 发布节奏

v0.2.0 为首次 npm 发布；之后每个版本走完整 dsh-factory 流程：本地验证 → npm publish → GitHub topic → awesome PR。

# schema 冻结合同 · AML（急性髓系白血病）· G3 · 2026-10-26

- 文件：`0001_initial.sql`（30 表：档案级 2 + 指标 3 + 通用 7 + AML 专属 18）
- sha256：`9322a9081134002add07faaa9dbee2e8fc9d9ad1b00bb064fc64bc7aded99bbe`
- 结构变更只允许新增 `000N_*.sql`；本文件哈希变动即冻结破坏，须评审留痕。

## 冻结断言（实测 2026-10-26，node:sqlite 内存加载）

1. **判读列断言**：全表全列扫描 `/diagnosis|risk_level|relapse|eligible|control_status|normal_flag|verdict|recommend/i` → **0 命中**。
2. 语法：`DatabaseSync.exec` 全量执行通过（30 表建成）。
3. K1–K6 落点：
   - K1 `tx_calendar_day(day_index, plan_date, actual_date, done, delay_reason)` —— 按天，无疗程聚合判定列；
   - K2 `fever_episode` + `temperature_reading(measured_at 到分钟)` + `fever_event(CALL/CULTURE/ANTIBIOTIC/ESCALATE/DEESCALATE)`；**判定不入库**（38.3/38.0+1h 由前端按定义原文分流，不入 SQL）；
   - K3 `mrd_result.method ∈ {FLOW, PCR}` 双口径并列，无复发判定列；
   - K4 `transplant_eval`/`donor_record` 全为原文列（status_text/doctor_reply），无推荐列；
   - K5 `transfusion_event` 独立轨道；
   - K6 `author_role` 贯穿可写表 + `visibility`（feeling_note 默认 private）。

## G3 留痕

- 2026-10-26 请求签认，用户未答 → 按推荐冻结，签认待补（可回退）。

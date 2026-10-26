# 项目规格 v0.1（SPEC）· 急性髓系白血病「小橙宝 OrangePal」

状态：**草案，待 G1 签认**。双主体（家属代记为主）；占位品牌小橙宝 OrangePal（白血病关怀丝带橙色）；aml-workbench。

## 0. 需求审计
核心：**诱导化疗日历按天（7+3）**+ **粒缺发热轨道（小时级）**+ MRD 双口径 + 移植评估 + 输注轨道 + 黏膜炎。红线 K1–K6。G1 待拍板：APL 分型边界/MRD 口径/病危记录 private/儿童 AML 边界 + 品牌 + 二期。

## 3. ADR
家族标准；client 链路 cervical 底本；apiBase 定稿契约；治疗线 32 折叠卡；README 33 号；**三新组件**：dayGrid（日格）/hourLane（小时体温）/Day+N 相对轴；MinerU 接入；AI 一键发送 34 号；模型路由 GLM-5.3+Flash。

## 4. 功能范围（10 线 27 页签，family-landscape §6）
F-DASH（看板）/ **F-DX（诊断与基因：病理/ELN 分层/基因三态）** / **F-IND（诱导与疗程：按天日历/疗程/复查骨穿）** / **F-NEUT（粒缺血象与支持：发热轨道/血象/输注）** / F-MRD（MRD 与随访）/ **F-TP（移植：评估/仓内/GVHD）** / F-CHART（一图秀）/ F-LIFE（营养与生活）/ F-MIND（情绪与签字压力，私密）/ F-DOCS（复诊与资料）/ F-SET。

## 7. 验收
G1 → G2（四必查件+HVT+窄宽+computed fill+**dayGrid/hourLane 渲染断言**）→ G3 → V1 → V2/V3（先新建会话）。✅🔧⏳。

## 8. 明确不做
诊断/分层判定/移植方案推荐/"粒缺期能不能出门"指导（只记事实与医生原话）/APL 专属模块（G1 决策）/多用户云同步。

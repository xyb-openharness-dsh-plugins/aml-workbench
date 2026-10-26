-- 0001_initial.sql · AML（急性髓系白血病）工作台初始迁移（G3 冻结候选 · 2026-10-26）
-- 来源：家族四契约骨架（原创 AML 版）+ 10 线 27 页签页面树 + K1–K6 红线。
-- 冻结规则：sha256 记入 schema/freeze-contract.md；结构变更只能新增 000N_*.sql。
-- AML 红线落点：
--   K1 诱导化疗按天（tx_calendar_day，day_index 逐日；无"疗程"聚合判定列）
--   K2 粒缺发热独立轨道（fever_episode + temperature_reading 小时级 + anc 化验；判定不入库，由前端按定义原文分流）
--   K3 MRD 双口径（mrd_result.method='FLOW'|'PCR'，两口径并列，无复发判定列）
--   K4 移植评估（transplant_eval + donor_record，医生答复原文；无推荐列）
--   K5 输注独立轨道（transfusion_event）
--   K6 双主体（author_role 贯穿）+ 私密三出口（visibility）

-- ═══ 档案级（2）═══
CREATE TABLE workspace (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data_root TEXT,
  schema_version TEXT NOT NULL,
  dataset_state TEXT
);
CREATE TABLE profile (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  birth_date TEXT,
  gender TEXT,
  primary_role TEXT CHECK (primary_role IN ('PATIENT','CAREGIVER')),
  cognitive_flag TEXT CHECK (cognitive_flag IN ('stable','changed')),
  created_at TEXT NOT NULL
);

-- ═══ 指标（3；ANC/WBC/Hb/PLT/CRP/铁蛋白走 metric_def+metric_point）═══
CREATE TABLE metric_def (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  unit TEXT,
  category TEXT NOT NULL,                 -- 'cbc' | 'inflammation' | 'chemistry'（趋势白名单）
  color TEXT,
  is_numeric INTEGER NOT NULL DEFAULT 1,
  ord INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE metric_point (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profile(id),
  code TEXT NOT NULL REFERENCES metric_def(code),
  measured_at TEXT NOT NULL,
  value_num REAL,
  value_text TEXT,
  unit TEXT,
  ref_range_text TEXT,
  source_note TEXT,
  author_role TEXT CHECK (author_role IN ('PATIENT','CAREGIVER')),
  in_use INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE lab_result (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  panel TEXT,
  ref_range TEXT,
  document_id INTEGER
);

-- ═══ 通用（7）═══
CREATE TABLE symptom_log (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  logged_at TEXT NOT NULL,
  symptom TEXT NOT NULL,
  severity_text TEXT,
  author_role TEXT NOT NULL CHECK (author_role IN ('PATIENT','CAREGIVER')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  ord INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE question (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fact','view')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  asked_on TEXT,
  from_scenario TEXT,
  ord INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE task (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  title TEXT NOT NULL,
  due_on TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  ord INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE document (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','parsed','parse_failed')),
  imported_at TEXT NOT NULL,
  ord INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE saved_trial (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  trial_key TEXT NOT NULL,
  saved_at TEXT NOT NULL
);
CREATE TABLE visit_summary (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  visit_date TEXT NOT NULL,
  range_from TEXT, range_to TEXT,
  body TEXT NOT NULL,
  author_role TEXT CHECK (author_role IN ('PATIENT','CAREGIVER')),
  ord INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE feeling_note (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  logged_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('FEEL','DEATH_PREP','BURDEN')),
  content TEXT NOT NULL,
  author_role TEXT NOT NULL CHECK (author_role IN ('PATIENT','CAREGIVER')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public','private')),
  ord INTEGER NOT NULL DEFAULT 0
);

-- ═══ AML 专属（12）═══
-- 诊断与基因（K3 语境：分层只存医院结论原文）
CREATE TABLE diagnosis_record (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  confirmed_on TEXT,
  subtype_text TEXT,                      -- 亚型原文（M0–M7 等，照抄报告）
  risk_text TEXT,                         -- 分层结论原文（医院给的，本台不计算）
  marrow_text TEXT,                       -- 骨穿描述原文
  report_doc_id INTEGER,
  ord INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE molecular_marker (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  marker TEXT NOT NULL,                   -- FLT3-ITD/NPM1/CEBPA/IDH1/IDH2/KIT/TP53…
  status TEXT NOT NULL CHECK (status IN ('detected','not_detected','not_tested')),
  value_text TEXT,                        -- 报告原文（如 VAF）
  method TEXT, specimen_date TEXT,
  report_doc_id INTEGER,
  note TEXT,
  ord INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE molecular_marker_title ( marker TEXT PRIMARY KEY, title TEXT NOT NULL, ord INTEGER NOT NULL DEFAULT 0 );
CREATE TABLE consult_note (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  consult_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('MDT','SECOND_OPINION','OTHER')),
  content TEXT NOT NULL,                  -- 会诊意见原文
  institution TEXT,
  report_doc_id INTEGER,
  ord INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1
);
-- K1：诱导化疗按天
CREATE TABLE tx_calendar_day (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  cycle_label TEXT NOT NULL,              -- "诱导 1（7+3）"
  day_index INTEGER NOT NULL,             -- 1..N，按天
  plan_date TEXT NOT NULL,
  actual_date TEXT,
  drugs_text TEXT,                        -- 当日用药原文（阿糖胞苷/柔红霉素…）
  done INTEGER NOT NULL DEFAULT 0,
  delay_reason TEXT,                      -- 延迟原因（患者语言）
  ord INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE tx_phase (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  cycle_label TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('INDUCTION','CONSOLIDATION','MAINTENANCE','INTENSIFICATION')),
  start_date TEXT, end_date TEXT,
  plan_text TEXT,                         -- 方案原文
  outcome_note TEXT,                      -- 医生告知原文（不评疗效）
  ord INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1
);
-- K2：粒缺发热轨道（小时级；判定不入库）
CREATE TABLE fever_episode (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  label TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  outcome_note TEXT,                      -- 转归原文（医生记录）
  ord INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE temperature_reading (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profile(id),
  episode_id INTEGER REFERENCES fever_episode(id),
  measured_at TEXT NOT NULL,              -- 精确到分钟（小时级轨道）
  value_c REAL NOT NULL,
  site TEXT CHECK (site IN ('AXILLARY','ORAL','EAR')),
  author_role TEXT NOT NULL CHECK (author_role IN ('PATIENT','CAREGIVER')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  ord INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE fever_event (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  episode_id INTEGER REFERENCES fever_episode(id),
  event_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('CALL','CULTURE','ANTIBIOTIC','ESCALATE','DEESCALATE')),
  text TEXT NOT NULL,                     -- 事件原文
  note TEXT,
  author_role TEXT CHECK (author_role IN ('PATIENT','CAREGIVER')),
  ord INTEGER NOT NULL DEFAULT 0
);
-- K5：输注独立轨道
CREATE TABLE transfusion_event (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  event_date TEXT NOT NULL,
  component TEXT NOT NULL CHECK (component IN ('RBC','PLATELET','PLASMA')),
  units_text TEXT NOT NULL,
  irradiated INTEGER, leukoreduced INTEGER,
  reaction TEXT,                          -- 反应原文
  author_role TEXT CHECK (author_role IN ('PATIENT','CAREGIVER')),
  ord INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1
);
-- 黏膜炎与感染（独立轨道，不并入血象趋势）
CREATE TABLE mucositis_log (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  logged_at TEXT NOT NULL,
  grade_text TEXT,                        -- 分级原文（WHO 分级照抄）
  site TEXT, symptom_text TEXT,
  author_role TEXT NOT NULL CHECK (author_role IN ('PATIENT','CAREGIVER')),
  ord INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE infection_record (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  onset_date TEXT NOT NULL,
  site_text TEXT, organism_text TEXT,     -- 病原学原文
  treatment_text TEXT,                    -- 医嘱原文
  resolved_on TEXT,
  report_doc_id INTEGER,
  ord INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1
);
-- K3：MRD 双口径并列（无复发判定列）
CREATE TABLE mrd_result (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  measured_at TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('FLOW','PCR')),
  value_text TEXT,                        -- 原文（如 0.02% / 阴性 / 未检出）
  sensitivity_text TEXT,                  -- 检测下限原文
  specimen TEXT,                          -- 骨髓/外周血
  report_doc_id INTEGER,
  ord INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE marrow_procedure (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  done_on TEXT NOT NULL,
  purpose_text TEXT,
  result_text TEXT,                       -- 报告原文
  report_doc_id INTEGER,
  ord INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1
);
-- K4：移植评估（零推荐）
CREATE TABLE transplant_eval (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  eval_date TEXT NOT NULL,
  status_text TEXT NOT NULL,              -- 状态原文（如"评估中"）
  items_text TEXT,                        -- 评估项原文
  doctor_reply TEXT,                      -- 医生答复原文
  ord INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE donor_record (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  donor_type TEXT NOT NULL,               -- 同胞全合/半相合/无关/脐血（原文）
  relation_text TEXT,
  hla_text TEXT,                          -- HLA 相合度原文
  search_note TEXT,
  confirmed_on TEXT,
  ord INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE gvhd_log (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  logged_at TEXT NOT NULL,
  organ_text TEXT, grade_text TEXT,
  treatment_text TEXT,
  author_role TEXT CHECK (author_role IN ('PATIENT','CAREGIVER')),
  ord INTEGER NOT NULL DEFAULT 0
);
-- 营养与出入量（独立轨道）
CREATE TABLE intake_log (
  id INTEGER PRIMARY KEY,
  profile_id TEXT NOT NULL,
  logged_at TEXT NOT NULL,
  intake_level TEXT CHECK (intake_level IN ('OK','REDUCED','MINIMAL')),
  weight_kg REAL,
  note TEXT,
  author_role TEXT CHECK (author_role IN ('PATIENT','CAREGIVER')),
  ord INTEGER NOT NULL DEFAULT 0
);

-- ═══ 种子（分节标题）═══
INSERT INTO molecular_marker_title (marker, title, ord) VALUES
  ('FLT3-ITD','FLT3-ITD', 1), ('NPM1','NPM1', 2), ('CEBPA','CEBPA', 3),
  ('IDH1','IDH1', 4), ('IDH2','IDH2', 5), ('KIT','KIT', 6), ('TP53','TP53', 7);

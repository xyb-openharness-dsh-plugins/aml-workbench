/* 36 号 · 疾病概要数据（小橙宝 OrangePal · 急性髓系白血病 AML）
 * 只写解释层：定义、文件、指南列出的手段、已经发生的版本与登记事实。
 * 规范：xyb-workbench-starter/docs/36-DISEASE-PRIMER.md；本项目实例清单：docs/DISEASE-PRIMER.md
 * 数据契约：window.DISEASE_PRIMER = { brand, name, en, updated, sections[] }
 *
 * 内容全部来自本仓 research-notes/medical-constraints.md 的编号来源（1.1–9.x），不搬其它癌种。
 * 尚未取得原件的条目一律标 original:false 并写清二次来源，不假装看过原文。
 */
window.DISEASE_PRIMER = {
  brand: '小橙宝 OrangePal',
  name: '急性髓系白血病',
  en: 'Acute Myeloid Leukemia',
  updated: '2026-10-26',
  sections: [
    {
      id: 'definition',
      title: '定义',
      intro: '急性髓系白血病（AML）是髓系原始细胞在骨髓里异常增殖、挤占正常造血的恶性肿瘤。'
        + '中国指南按形态学、免疫表型、遗传学与分子特征综合诊断；一个疗程的成败常以「是否达到完全缓解（CR）」来表述，'
        + '而 CR 只说明显微镜下原始细胞降到阈值以下，不等于治愈。'
        + '本台不判断你的分型对不对、也不判断你缓解没缓解。',
      points: [
        '起病常见路径：体检或感冒查血常规发现白细胞异常、贫血、血小板减少 → 外周血涂片见原始细胞 → 骨髓穿刺。这一步的顺序在整个家族里是共同的，AML 的特殊之处是时间压力：多数患者从确诊到开始诱导化疗以天计，而不是以周计。',
        '四大检查各有自己的出结果时间，患者最容易被「报告还没全」搞糊涂：形态学当天、流式免疫分型 2–3 天、染色体核型 3–7 天（分裂相不足时还会失败重做）、分子基因 3–7 天（NGS 更久）。所以「7+3 先打上」与「等基因结果再定方向」可以同时发生，不是医生前后矛盾。',
        '分型要分两层看：一是 WHO 2022 与 ICC 两套分类体系并存（名字都很长，两套不换算）；二是 ELN 2022 风险分层（预后良好 / 中间 / 不良三组）。分类说的是「这是什么病」，风险分层说的是「这一组人统计上结局不同」——两者都不是对个人的判决，本台两处都只记录医院原文。',
        'AML 与 APL 必须分开：急性早幼粒细胞白血病（APL，t(15;17)/PML-RARA）有自己的止血与诱导路径，进展快、早期出血风险高，处理方式与其它 AML 不同。本台当前的两个演示档案都是 AML 非APL，7+3 与低强度方案只适用于非APL；APL 的诱导日历结构不同，本台尚未整理（不把 7+3 的日历套过去）。',
        '「粒缺」不是「免疫力差一点」这种程度词：ANC < 0.5×10⁹/L 是一个可测量的门槛，它决定发热时要不要按急症处理、要不要按铃。',
        '本台不判断原始细胞百分比意味着什么、不判断 MRD 阳性是不是复发、不建议移植或不移植。判读归你的血液科团队。'
      ],
      sources: [
        { org: '中华医学会血液学分会', doc: '中国成人急性髓系白血病（非APL）诊断与治疗指南（2021 年版）', version: '2021', original: true, url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8501285', page: '全文可读（PMC8501285）' },
        { org: 'ELN（欧洲白血病网）', doc: 'Diagnosis and management of AML in adults: 2022 recommendations（Döhner 等，Blood）', version: '2022', original: true, url: 'https://ashpublications.org/blood/article/140/12/1345/485817/Diagnosis-and-management-of-AML-in-adults-2022', page: '官方页（开放获取，可下载 PDF）' },
        { org: 'NCI（美国国家癌症研究所）', doc: 'Adult Acute Myeloid Leukemia Treatment（PDQ）患者版', version: '2025-05 更新', original: false, secondaryUrl: 'https://www.cancer.gov/types/leukemia/patient/adult-aml-treatment-pdq', page: '页码待核', note: '美国语境；诊断时点与中国实践基本一致' }
      ]
    },
    {
      id: 'evidence',
      title: '医学资料规范和指南情况',
      intro: '一台一表，不合并。未取得原件的只记「存在、大致讲什么」，不引用具体条文；两套分类体系并存时两行都列，本表不做换算。',
      table: {
        head: ['机构', '文件', '版本 / 日期', '原件', '本台的用途'],
        rows: [
          ['中华医学会血液学分会', '中国成人 AML（非APL）诊断与治疗指南（2021 年版）', '2021', { text: '已取得（全文可读）', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8501285' }, '诊断流程、7+3 骨架方案、停化疗后第 7–14 天复查骨穿的窗口'],
          ['ELN（欧洲白血病网）', 'AML 成人诊断与治疗建议（Blood，Döhner 等）', '2022', { text: '已取得（开放获取）', url: 'https://ashpublications.org/blood/article/140/12/1345/485817/Diagnosis-and-management-of-AML-in-adults-2022' }, '风险分层三组、MRD 阈值语境'],
          ['中华医学会等', '中国中性粒细胞缺乏伴发热患者抗菌药物临床应用指南（2020 年版）', '2020-12', { text: '已取得（英文版 PMC）', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7840550' }, '粒缺发热定义：口腔 ≥38.3℃ 单次，或 ≥38.0℃ 持续 >1 小时，且 ANC<0.5 或预计 48 小时内降至 0.5 以下'],
          ['中华医学会血液学分会、中国医师协会血液科医师分会', '中性粒细胞缺乏伴发热患者抗菌药物临床应用中国指南（2026 年版）', '2026（PMC 上线 2026）', { text: '已取得（PMC 全文）', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC13195557' }, '2020 版的更新版，含 CRO 耐药菌内容；本台仍按 2020 版口径写定义，上线前须按本版校对'],
          ['NCCN', 'NCCN Clinical Practice Guidelines in Oncology: AML', '3.2026（2025-11-24 发布，取代 2.2026）', { text: '未取得原件（正文需注册下载）', url: 'https://www.nccn.org/guidelines/category_1' }, '仅在范围声明中写「参照 NCCN AML 3.2026」，不引条文'],
          ['CSCO', 'CSCO 恶性血液病诊疗指南 2025', '2025-04（发布报道）', { text: '未取得原件，据会议报道', url: 'https://www.csco.org.cn/cn/ncontent.aspx?oid=2379' }, '仅记录「2024/2025 有更新」这一事实'],
          ['ELN', 'AML MRD 更新', '2021', { text: '已取得（开放获取）', url: 'https://ashpublications.org/blood/article/138/26/2753/477736/2021-Update-on-MRD-in-acute-myeloid-leukemia-a' }, '0.01% / 0.1% 阈值语境的原始出处之一'],
          ['中国专家共识', '造血干细胞移植临床实践整体评估中国专家共识（2025 年版）', '2025', { text: '未取得原件，据平台转介', url: 'https://www.ihemato.com/Detail?id=1191' }, '仅列「有这份共识」，移植适应语境不引条文']
        ]
      },
      sources: [
        { org: '见上表逐行', doc: '本表每行单独标注原件取得情况', version: '—', original: false, nolink: true, page: '不适用', note: '「原件」一栏即逐行判定，未取得原件的行不引条文（本行是说明行，无对应文件，不适用链接）' }
      ]
    },
    {
      id: 'landscape',
      title: '目前治疗全景概要',
      intro: '按治疗阶段与线序列出文献与指南里出现过的手段。这里排的是「文献里的顺序」，不是「给你的顺序」。',
      groups: [
        {
          label: '诱导（第一次把病压下去）',
          points: [
            '标准骨架「7+3」：阿糖胞苷连输 7 天 + 蒽环类 3 天。中国指南同时允许按年龄、体能、合并症调整强度——同一份指南里就存在「标准强度」与「低强度」两条路，选择取决于医生评估，不是病期轻重的简单对应。',
            '低强度路线常见组合为去甲基化药物（阿扎胞苷 / 地西他滨）联合维奈克拉。维奈克拉在中国首次上市为 2020 年 12 月（国家医保局 2022 年申报材料载明），具体适应症须核对说明书。',
            'APL 不走 7+3：以全反式维甲酸（ATRA）联合砷剂为核心的诱导路径，早期重点在止血管理。本台当前只整理非APL 的诱导与巩固日历；APL 线尚未建立（结构不同，不套用 7+3 的日历）。',
            '诱导后约停化疗第 7–14 天复查骨穿（中国指南明确写此窗口）：看原始细胞是否残留。这一步的时间窗是患者最容易焦虑的地方——「还没到复查日就先别给自己下结论」。'
          ]
        },
        {
          label: '巩固（把缓解状态守住）',
          points: [
            '常见为 HiDAC（大剂量阿糖胞苷）多个疗程；疗程数与间隔取决于风险组与耐受情况。中国指南载有剂量上限，但各中心习惯不同，字段允许医生自定义。',
            '巩固期内仍会出现粒缺与血象低谷，所以「巩固期也要按粒缺期过日子」是本台单独做一条日历线的原因。'
          ]
        },
        {
          label: '移植评估（不是所有人都走这条）',
          points: [
            '异基因造血干细胞移植在指南里是「以风险换治愈机会」的选项：高危/ELN 不良组常在第一次完全缓解（CR1）阶段即评估；中危若 MRD 持续阳性或复发后再缓解（CR2）也是主要评估时点。',
            '评估包含供者 HLA 分型（部分中心在诊断时即对家属抽血）、脏器功能、合并症与心理社会评估。本台只记录评估进度与结论原文，不给「该不该做」的意见。'
          ]
        },
        {
          label: '复发后',
          points: [
            '再诱导化疗（含氟达拉滨的联合方案语境，如 FLAG 类）、按基因选择靶向药、临床试验、再缓解后移植——文献里这些路径并存，顺序由医生按个体情况排列。',
            '按基因选择的部分举例：FLT3 突变对应吉瑞替尼（NMPA 2021 年获批，FLT3 突变复发/难治 AML）、IDH1 突变对应艾伏尼布（NMPA 2022 年 1 月获批，IDH1 易感突变复发/难治成人 AML）、BCL-2 对应维奈克拉联合方案。具体适应症须逐一核对说明书。',
            '临床试验在复发阶段是正规选项之一，不是「没办法了才去试」。本台把试验检索做成独立入口，并明确标注「登记 ≠ 有效 ≠ 安全 ≠ 可入组」。'
          ]
        },
        {
          label: '贯穿全程的支持治疗',
          points: [
            '粒缺伴发热按急症处理（中国 2020 指南口径：1 小时内启动经验性抗菌治疗）。这是本台把体温做成小时级轨道的原因。',
            '输血支持（红细胞 / 血小板）、口腔黏膜炎防治、止吐、真菌与病毒预防、营养与心理支持——每一项都有自己的评估与记录点，本台分线记录，不合并成一句「注意休息」。'
          ]
        }
      ],
      points: [
        '以上是文献与指南里列出的手段，按病期与线序排列，不代表任何一项适合你。选哪一个，这一句需要问你的医生。'
      ],
      sources: [
        { org: '中华医学会血液学分会', doc: '中国成人 AML（非APL）指南（2021 年版）', version: '2021', original: true, url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8501285', page: '全文可读' },
        { org: 'ELN', doc: 'AML 成人诊断与治疗建议（2022）', version: '2022', original: true, url: 'https://ashpublications.org/blood/article/140/12/1345/485817/Diagnosis-and-management-of-AML-in-adults-2022', page: '官方页（开放获取）' },
        { org: '国家医疗保障局', doc: '维奈克拉片医保申报材料', version: '2022 申报', original: false, secondaryUrl: 'https://www.nhsa.gov.cn/col/col104/index.html', page: '载明首次上市 2020-12', note: '申报材料非公开文件；本行只记「医保局收到申报」这一事实，批件号未核实' },
        { org: 'NCCN', doc: 'NCCN AML 3.2026', version: '2025-11-24', original: false, page: '页码待核', note: '仅用作范围声明，不引条文' , secondaryUrl: 'https://www.nccn.org/updates'}
      ]
    },
    {
      id: 'trend',
      title: '发展趋势',
      intro: '只写已经发生的事实，每条带日期或版本号。不写展望、预测、推荐与优劣比较。',
      points: [
        '指南版本：NCCN AML 现行版为 3.2026，2025-11-24 发布，取代 2.2026。中国指南方面，项目 2026-10-25 记录到 CSCO 恶性血液病诊疗指南 2025 已发布（会议报道，2025-04），正文为实体书，未取得。',
        '指南更新：ELN 2022 建议之后是否有 2024–2026 版更新，本项目未核实——写作时按「ELN 2022 为最新已取得版本」处理，不假设没有新版。',
        '监管批件（说明书级）：吉瑞替尼 NMPA 2021 年获批（FLT3 突变复发/难治 AML）；艾伏尼布 NMPA 2022 年 1 月获批（IDH1 易感突变复发/难治成人 AML）；维奈克拉中国首次上市 2020 年 12 月（据国家医保局 2022 年申报材料）。批准日期与批件号未逐条核实。',
        '支持治疗规范：中性粒细胞缺乏伴发热的中国指南存在 2020 版与 2026 新版两个版本；2026 版含 CRO 耐药菌更新，本项目未取得全文。',
        '在研登记：2026-10-26 快照，去重后 241 条（中国药物临床试验登记与信息公示平台 188 条、CTV 53 条），登记状态一律「登记状态，未核实」；ChiCTR 与 ICTRP 本次采集未成功，属采集缺口而非「没有登记」。',
        '分类体系：本台按 WHO 2022 与 ICC 两套体系并记，不换算；项目资料未见更新的分类版本记载。'
      ],
      sources: [
        { org: 'NCCN', doc: 'NCCN Guidelines: AML', version: '3.2026（2025-11-24）', original: false, page: '页码待核', note: '仅元信息' , secondaryUrl: 'https://www.nccn.org/updates'},
        { org: 'CSCO', doc: 'CSCO 恶性血液病诊疗指南 2025（发布报道）', version: '2025-04', original: false, page: '不适用', note: '据会议报道，正文未取得' , secondaryUrl: 'https://www.csco.org.cn/cn/ncontent.aspx?oid=2379'},
        { org: '本项目登记快照', doc: 'research/aml-cancer/manifest.json（unified-trial-mcp）', version: '2026-10-26', original: false, nolink: true, page: '不适用', note: '本仓内文件（无公网链接，见 research/ 目录）：241 条去重；ChiCTR/ICTRP 采集失败如实记录' },
        { org: '国家医疗保障局', doc: '维奈克拉片医保申报材料', version: '2022 申报', original: false, secondaryUrl: 'https://www.nhsa.gov.cn/col/col104/index.html', page: '不适用', note: '同上：申报材料非公开文件，只记事实' }
      ]
    }
  ]
}

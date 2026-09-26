import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ============================================================
// AI 配置项（对应 PRD「先留出 API Key 配置项」）
// 通过 server/.env 或环境变量配置
// ============================================================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// ============================================================
// 固定 AI Prompt（产品核心壁垒，对应 PRD 第 5 点，逐字照抄）
// ============================================================
const SYSTEM_PROMPT = `你是线下实体商业复盘AI分析师，专注摆摊、校园业态、线下地推经营分析。
请对用户输入的零散经营记录、销量数据、顾客反馈、经营现象，严格按照固定格式输出，禁止闲聊。
输出固定结构：
1.经营数据结构化整理：梳理用户今日销量、客流、转化、经营异常数据
2.核心经营痛点归因：精准分析客流波动、转化高低、用户不满、定价、选品、时段问题
3.顾客需求&消费偏好总结：提炼真实用户消费习惯、敏感点、喜好
4.落地运营优化方案：给出具体、可直接落地的次日经营策略（选品、定价、出摊时段、服务优化）
最后固定提示：本AI复盘仅为经营辅助分析，实际经营决策请人工结合场景校验。`;

const DISCLAIMER = '本AI复盘仅为经营辅助分析，实际经营决策请人工结合场景校验。';

const SECTION_DEFS = [
  { title: '经营数据结构化整理' },
  { title: '核心经营痛点归因' },
  { title: '顾客需求&消费偏好总结' },
  { title: '落地运营优化方案' },
];

// ============================================================
// 解析 AI 返回的固定结构，拆分为 4 个独立模块 + 固定提示
// ============================================================
function parseSections(raw) {
  const text = (raw || '').replace(/\r\n/g, '\n').trim();
  const positions = SECTION_DEFS.map((d) => text.indexOf(d.title));

  const sections = SECTION_DEFS.map((d, i) => {
    let content = '';
    const start = positions[i];
    if (start >= 0) {
      const from = start + d.title.length;
      let end = text.length;
      for (let j = i + 1; j < positions.length; j++) {
        if (positions[j] > start) {
          end = positions[j];
          break;
        }
      }
      const disc = text.indexOf('本AI复盘仅为经营辅助分析');
      if (disc > from && disc < end) end = disc;
      content = text.slice(from, end).replace(/^[:：\s]*/, '').replace(/\s+$/, '');
    }
    return { title: d.title, content };
  });

  // 若解析失败（AI 未按格式输出），整体退化为单模块展示
  if (sections.every((s) => !s.content)) {
    sections[0].content = text;
  }
  return sections;
}

// ============================================================
// 未配置 API Key 时的本地模拟数据（保证无 Key 也能端到端演示）
// ============================================================
function buildMockSections(content) {
  const brief = content.replace(/\s+/g, ' ').slice(0, 60);
  return [
    {
      title: '经营数据结构化整理',
      content: `• 原始记录摘要：${brief}……
• 销量：已识别今日销量数据，建议继续按「商品品类 × 规格」拆分统计基线
• 客流：识别到路过 / 驻足 / 成交三个层级，请统一转化率口径（成交 ÷ 驻足）
• 转化：用于评估现场承接与话术转化能力，重点看高峰与非高峰时段的差距
• 经营异常：已标记时段波动、天气影响、价格比价等异常信号`,
    },
    {
      title: '核心经营痛点归因',
      content: `• 客流问题：高频时段集中、非高峰时段明显回落，存在时段利用不充分
• 转化问题：驻足到成交的转化有提升空间，可能受排队等待与话术影响
• 定价问题：与周边同类比价后出现流失，价格敏感型顾客占比上升
• 选品问题：SKU 层级与规格选项（少糖/常温等）覆盖不足，错失细分需求
• 服务问题：高峰期出餐速度慢，等待过久直接劝退部分顾客`,
    },
    {
      title: '顾客需求&消费偏好总结',
      content: `• 价格敏感：存在明确比价行为，需设置锚点价或组合优惠对冲
• 口味偏好：对甜度、温度有细分诉求，期望更多自定义选项
• 时间敏感：高峰期对出餐速度高度敏感，等待是主要流失点
• 场景偏好：夜间、天气变化对购买意愿影响显著，方案需考虑应急承接`,
    },
    {
      title: '落地运营优化方案',
      content: `• 选品：增加少糖/常温档位，推出「双杯组合」提升客单价与出单效率
• 定价：设定价格锚点 + 满减/第二杯半价，弱化直接比价损失
• 出摊时段：把高峰时段提前备料，非高峰用促销拉流或主动收摊止损
• 服务优化：预做半成品压缩出餐时间，高峰期增派一人专职打包
• 防御预案：关注天气，备轻量雨棚与雨天促销话术，减少原料损耗`,
    },
  ];
}

// ============================================================
// 路由
// ============================================================
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, model: OPENAI_MODEL, keyConfigured: !!OPENAI_API_KEY });
});

app.post('/api/review', async (req, res) => {
  const content = (req.body?.content || '').trim();

  // 规则：空输入拦截，防止无效请求（PRD 第 6 点）
  if (!content) {
    return res.status(400).json({ error: '请输入今日经营记录后再开始 AI 复盘' });
  }

  // 未配置 API Key：返回本地模拟数据，保证 Demo 端到端可跑通
  if (!OPENAI_API_KEY) {
    return res.json({
      sections: buildMockSections(content),
      disclaimer: DISCLAIMER,
      demo: true,
    });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const resp = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.7,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `${content}\n\n请严格按照上述固定结构输出，四个标题使用原文，不要输出任何额外说明。`,
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(502).json({
        error: `AI 接口调用失败（${resp.status}）：${errText.slice(0, 200)}`,
      });
    }

    const data = await resp.json();
    const reply = data?.choices?.[0]?.message?.content || '';

    if (!reply.trim()) {
      return res.status(502).json({ error: 'AI 返回内容为空，请重试' });
    }

    return res.json({
      sections: parseSections(reply),
      disclaimer: DISCLAIMER,
      demo: false,
    });
  } catch (err) {
    return res.status(502).json({
      error: `AI 接口调用异常：${err.message || String(err)}`,
    });
  }
});

app.listen(PORT, () => {
  console.log(`[server] 复盘后端已启动：http://localhost:${PORT}`);
  console.log(
    `[server] AI 配置状态：${OPENAI_API_KEY ? `已配置 Key（model=${OPENAI_MODEL}）` : '未配置 Key，将返回本地模拟数据'}`,
  );
});
import OpenAI from "openai";

export const maxDuration = 60;

const MAX_INPUT_CHARS = 24000;

type ReviewStyle = "normal" | "expert" | "exam";

const BASE_ROLE = "你是一个资深的大模型复习导师。";

const OUTLINE_STYLE: Record<ReviewStyle, string> = {
  normal: "请通俗易懂地提炼核心概念，按由浅入深的顺序生成大纲，不需要太深奥。",
  expert: "请深入剖析底层逻辑和公式推导，列出易混淆概念对比，并补充工程应用场景。",
  exam: "请只提取历年考试高频考点，预测大题方向，并列出必须背诵的简答题要点。",
};

const QUIZ_STYLE: Record<ReviewStyle, string> = {
  normal: "生成 5 道基础选择题，侧重概念定义，解析要大白话。",
  expert: "生成 3 道复杂选择题和 2 道计算/简答题，侧重综合应用。",
  exam: "模拟期末考试卷，生成包含选择题、填空题和综合计算题的混合卷，分值设定合理。",
};

const OUTLINE_FORMAT = `通用要求：
1. 使用 Markdown（## / ### / - ）组织内容
2. 提取概念、定义、对比、公式和流程步骤
3. 每个考点用 1-3 句说明为什么重要、考试可能怎么考
4. 只依据给定文本，不要编造文本中没有的知识点
5. 使用简体中文
6. 如果出现公式、变量、下标或上标，必须使用 LaTeX，并用 $ 包裹。不要写 I_D、UGS=-2V 这种纯文本。例如 $I_{D}$、$U_{GS}=-2V$。
7. 如果使用表格，表格前后必须各空一行，并使用标准 Markdown 表格，不能省略表头分隔线。例如：

| 概念 | 说明 |
| --- | --- |
| 进程 | 资源分配的基本单位 |`;

const QUIZ_JSON_RULES = `必须输出纯 JSON 数组格式，不要包含任何 Markdown 代码块标记（如 \`\`\`json ），不要输出 JSON 以外的任何废话。
JSON 数组中的每个对象必须严格包含以下字段：
"type": 必须是 "choice"、"fill_blank" 或 "calculation" 三者之一。
"question": 题目内容。如需标注分值，直接写在题干里，例如「（10分）」，不要新增字段。
"options": 仅当 type 为 "choice" 时才有此字段，是一个包含 4 个字符串的数组。其他题型该字段为 null。
"answer": 标准答案。选择题的 answer 只能是 A、B、C 或 D，不要把选项字母放进公式。
"explanation": 详细解析（计算题需给出解题步骤）。
极其重要的格式要求：question、options、answer、explanation 里只要出现数学公式、变量、下标或上标（包括平方），必须严格使用 LaTeX，并用 $ 包裹。不要使用没有定界符的纯文本，也不要使用 \\( \\) ，因为反斜杠会破坏 JSON。
例如：不要写 I_D = I_DSS(1 - U_GS/U_GS(off))^2，必须写成 $I_D = I_{DSS}(1 - U_{GS}/U_{GS(off)})^2$。不要写 UGS=-2V，必须写成 $U_{GS}=-2V$。
如果不使用 $ 包裹公式，前端将无法正确显示。`;

type QuizType = "choice" | "fill_blank" | "calculation";

type QuizItem = {
  type: QuizType;
  question: string;
  options: [string, string, string, string] | null;
  answer: string;
  explanation: string;
};

function readAttemptCount(value: unknown) {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(count) || count < 1) return 1;
  return Math.min(Math.floor(count), 99);
}

function readReviewStyle(value: unknown): ReviewStyle {
  if (value === "normal" || value === "expert" || value === "exam") return value;
  return "normal";
}

function quizDifficultyInstruction(attemptCount: number) {
  if (attemptCount <= 1) return "生成基础概念题，难度适中。";
  return "用户已进行过复习，请生成更具迷惑性的进阶题、综合应用题，或者需要多步计算的高难度题目。请绝对不要与之前的常考基础题重复，尝试从课件的边角料或更深层的逻辑出题。";
}

function buildOutlineSystemPrompt(attemptCount: number, reviewStyle: ReviewStyle) {
  const extra =
    attemptCount > 1
      ? "\n8. 用户已经生成过大纲。请生成更详细的逻辑推导、或者补充更多的课外拓展延伸。延伸内容请单独标注为「拓展」，不要伪装成课件原文。"
      : "";
  return `${BASE_ROLE}
${OUTLINE_STYLE[reviewStyle]}
${OUTLINE_FORMAT}${extra}`;
}

function buildQuizSystemPrompt(text: string, attemptCount: number, reviewStyle: ReviewStyle) {
  const repeat =
    attemptCount > 1 ? `\n难度要求：${quizDifficultyInstruction(attemptCount)}` : "";
  return `${BASE_ROLE}
请根据课件文本生成复习测验。出题要求：${QUIZ_STYLE[reviewStyle]}${repeat}
${QUIZ_JSON_RULES}

课件内容如下：
${text}`;
}

function parseQuizPayload(raw: string, reviewStyle: ReviewStyle): QuizItem[] {
  try {
    const sliced = extractJsonArray(raw);
    const candidates = [sliced, sliced.replace(/,\s*([}\]])/g, "$1")];
    let lastError: unknown;

    for (const candidate of candidates) {
      try {
        return normalizeQuizItems(parseJsonValue(candidate), reviewStyle);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("测验结果不是合法的 JSON");
  } catch (error) {
    console.error("Quiz JSON parse failed. Raw model output:\n" + raw);
    throw error;
  }
}

/** 丢掉代码围栏和前后说明，只保留第一个 [ 到最后一个 ]。 */
function extractJsonArray(raw: string) {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) {
    throw new Error("测验结果中没有找到 JSON 数组");
  }
  return raw.slice(start, end + 1);
}

function parseJsonValue(text: string): unknown {
  const value = JSON.parse(text);
  if (typeof value === "string") return JSON.parse(extractJsonArray(value));
  return value;
}

function quizShapeIsShort(style: ReviewStyle, counts: Record<QuizType, number>) {
  if (style === "normal") return counts.choice < 5;
  if (style === "expert") return counts.choice < 3 || counts.calculation < 2;
  return counts.choice < 1 || counts.fill_blank < 1 || counts.calculation < 1;
}

function normalizeQuizItems(parsed: unknown, reviewStyle: ReviewStyle): QuizItem[] {
  if (!Array.isArray(parsed)) {
    throw new Error("测验结果不是 JSON 数组");
  }
  if (parsed.length === 0) {
    throw new Error("测验结果是空数组");
  }

  const items = parsed.map((item, index) => normalizeQuizItem(item, index));
  const counts = {
    choice: items.filter((item) => item.type === "choice").length,
    fill_blank: items.filter((item) => item.type === "fill_blank").length,
    calculation: items.filter((item) => item.type === "calculation").length,
  };
  if (quizShapeIsShort(reviewStyle, counts)) {
    console.warn("Quiz question counts are below the requested style:", reviewStyle, counts);
  }
  return items;
}

function normalizeQuizItem(item: unknown, index: number): QuizItem {
  if (!isRecord(item)) {
    throw new Error(`第 ${index + 1} 题格式不正确`);
  }

  const label = `第 ${index + 1} 题`;
  const type = (() => {
    try {
      return normalizeQuizType(item.type, item.options);
    } catch {
      throw new Error(`${label}的 type 必须是 choice、fill_blank 或 calculation`);
    }
  })();
  const question = readString(item.question);
  const explanation = readString(item.explanation);
  const rawOptions = Array.isArray(item.options)
    ? item.options.map((option) => readString(option).replace(/^[A-Da-d][\.、．:：]\s*/, "")).filter(Boolean)
    : [];

  if (!question || !explanation) {
    throw new Error(`${label}缺少 question 或 explanation`);
  }

  if (type !== "choice") {
    const answer = readString(item.answer);
    if (!answer) throw new Error(`${label}缺少 answer`);
    return { type, question, options: null, answer, explanation };
  }

  if (rawOptions.length !== 4) {
    throw new Error(`${label}的 options 必须是 4 个非空字符串`);
  }
  const options = rawOptions as [string, string, string, string];
  const answer = normalizeChoiceAnswer(readString(item.answer), options);
  if (!answer) throw new Error(`${label}缺少 answer`);

  return { type, question, options, answer, explanation };
}

function normalizeQuizType(type: unknown, options: unknown): QuizType {
  if (type === "choice" || type === "fill_blank" || type === "calculation") return type;
  if (Array.isArray(options) && options.length === 4) return "choice";
  throw new Error("type 必须是 choice、fill_blank 或 calculation");
}

function normalizeChoiceAnswer(answer: string, options: string[]) {
  const letter = answer
    .trim()
    .toUpperCase()
    .replace(/[\.、．:：].*$/, "");
  if (letter === "A" || letter === "B" || letter === "C" || letter === "D") return letter;

  const index = options.findIndex((option) => option === answer.trim());
  if (index >= 0) return "ABCD"[index] ?? answer.trim();
  return answer.trim();
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type GenerateMode = "outline" | "quiz";

function normalizeMode(mode: unknown): GenerateMode | null {
  if (mode === "outline" || mode === "大纲") return "outline";
  if (mode === "quiz" || mode === "测验") return "quiz";
  return null;
}

export async function POST(req: Request) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey.includes("your_deepseek_api_key")) {
    return new Response("缺少有效的 DEEPSEEK_API_KEY，请在 .env.local 中填入你的密钥", {
      status: 500,
    });
  }

  try {
    const body = (await req.json()) as {
      text?: unknown;
      mode?: unknown;
      attemptCount?: unknown;
      reviewStyle?: unknown;
    };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const mode = normalizeMode(body.mode);
    const attemptCount = readAttemptCount(body.attemptCount);
    const reviewStyle = readReviewStyle(body.reviewStyle);

    if (!text) {
      return new Response("请先提供课程文本", { status: 400 });
    }
    if (!mode) {
      return new Response("mode 只能是大纲（outline）或测验（quiz）", { status: 400 });
    }

    const clipped =
      text.length > MAX_INPUT_CHARS
        ? `${text.slice(0, MAX_INPUT_CHARS)}\n\n[文本过长，已截断]`
        : text;

    const client = new OpenAI({
      apiKey,
      baseURL: "https://api.deepseek.com",
    });

    const messages =
      mode === "outline"
        ? [
            { role: "system" as const, content: buildOutlineSystemPrompt(attemptCount, reviewStyle) },
            {
              role: "user" as const,
              content: `请根据下面的课程材料提取核心考点大纲：\n\n${clipped}`,
            },
          ]
        : [
            { role: "system" as const, content: buildQuizSystemPrompt(clipped, attemptCount, reviewStyle) },
            { role: "user" as const, content: "请只输出 JSON 数组。" },
          ];

    if (mode === "quiz") {
      const completion = await client.chat.completions.create({
        model: "deepseek-flash",
        stream: false,
        messages,
      });
      const raw = completion.choices[0]?.message?.content ?? "";

      try {
        return Response.json(parseQuizPayload(raw, reviewStyle));
      } catch (error) {
        console.error("Quiz JSON parse failed:", error);
        return new Response(error instanceof Error ? error.message : "测验结果解析失败", {
          status: 422,
        });
      }
    }

    const completion = await client.chat.completions.create({
      model: "deepseek-flash",
      stream: true,
      messages,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of completion) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              controller.enqueue(encoder.encode(content));
            }
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("Generate failed:", error);
    return new Response("调用大模型失败，请检查 API Key 或稍后重试", {
      status: 500,
    });
  }
}

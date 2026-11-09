import OpenAI from "openai";

export const maxDuration = 60;

const MAX_INPUT_CHARS = 24000;

const PROMPTS = {
  outline: `你是一位严谨的大学课程助教。请根据用户提供的课程文本，提取期末复习用的核心考点大纲。
要求：
1. 使用 Markdown（## / ### / - ）组织内容
2. 提取概念、定义、对比、公式和流程步骤
3. 每个考点用 1-3 句说明为什么重要、考试可能怎么考
4. 只依据给定文本，不要编造文本中没有的知识点
5. 使用简体中文`,
  quiz: `你是一位严谨的大学课程助教。请根据用户提供的课程文本生成一套复习测验，必须正好包含：
1. 5 道选择题：每题 4 个选项，标明正确答案，并给出一句解析
2. 3 道填空题：每题给出参考答案
3. 1 道计算题、编程题或简答题：根据材料选择最合适的一种，并给出参考解答
使用 Markdown 分节排版。只依据给定文本出题，不要编造文本中没有的知识点。使用简体中文。`,
} as const;

type GenerateMode = keyof typeof PROMPTS;

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
    const body = (await req.json()) as { text?: unknown; mode?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const mode = normalizeMode(body.mode);

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

    const completion = await client.chat.completions.create({
      model: "deepseek-flash",
      stream: true,
      messages: [
        { role: "system", content: PROMPTS[mode] },
        {
          role: "user",
          content:
            mode === "outline"
              ? `请根据下面的课程材料提取核心考点大纲：\n\n${clipped}`
              : `请根据下面的课程材料生成测验：\n\n${clipped}`,
        },
      ],
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

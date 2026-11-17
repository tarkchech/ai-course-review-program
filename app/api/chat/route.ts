import OpenAI from "openai";

export const maxDuration = 60;

const MAX_CONTEXT_CHARS = 24000;

type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

function readMessages(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as { role?: unknown; content?: unknown };
    const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : null;
    const content = typeof record.content === "string" ? record.content.trim() : "";
    if (!role || !content) return [];
    return [{ role, content }];
  });
}

export async function POST(req: Request) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey.includes("your_deepseek_api_key")) {
    return new Response("缺少有效的 DEEPSEEK_API_KEY，请在 .env.local 中填入你的密钥", {
      status: 500,
    });
  }

  try {
    const body = (await req.json()) as { messages?: unknown; contextText?: unknown };
    const contextText = typeof body.contextText === "string" ? body.contextText.trim() : "";
    const history = readMessages(body.messages);

    if (!contextText) {
      return new Response("请先上传课件，再向助教提问", { status: 400 });
    }
    if (history.length === 0 || history[history.length - 1]?.role !== "user") {
      return new Response("请输入要追问的问题", { status: 400 });
    }

    const clipped =
      contextText.length > MAX_CONTEXT_CHARS
        ? `${contextText.slice(0, MAX_CONTEXT_CHARS)}\n\n[文本过长，已截断]`
        : contextText;

    const client = new OpenAI({
      apiKey,
      baseURL: "https://api.deepseek.com",
    });

    const completion = await client.chat.completions.create({
      model: "deepseek-flash",
      stream: true,
      messages: [
        {
          role: "system",
          content: `你是一个专业的课程助教。请严格基于用户提供的以下课件内容回答问题。如果课件中没有，请诚实地回答不知道，不要胡编乱造。课件内容：${clipped}`,
        },
        ...history,
      ],
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of completion) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) controller.enqueue(encoder.encode(content));
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
    console.error("Chat failed:", error);
    return new Response("调用大模型失败，请检查 API Key 或稍后重试", { status: 500 });
  }
}

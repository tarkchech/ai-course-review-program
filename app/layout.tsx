import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 课程复习百宝箱",
  description: "上传 PDF、PPTX 或 JPG，用 DeepSeek 流式生成核心考点大纲",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <body className="flex min-h-full flex-col font-sans">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  theme: {
    extend: {
      typography: {
        slate: {
          css: {
            fontFamily:
              '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", ui-sans-serif, system-ui, sans-serif',
            maxWidth: "none",
            lineHeight: "1.75",
            "--tw-prose-body": "var(--color-slate-700)",
            "--tw-prose-headings": "var(--color-slate-900)",
            "--tw-prose-lead": "var(--color-slate-600)",
            "--tw-prose-links": "var(--color-indigo-600)",
            "--tw-prose-bold": "var(--color-slate-900)",
            "--tw-prose-counters": "var(--color-slate-500)",
            "--tw-prose-bullets": "var(--color-slate-400)",
            "--tw-prose-hr": "var(--color-slate-200)",
            "--tw-prose-quotes": "var(--color-slate-800)",
            "--tw-prose-quote-borders": "var(--color-indigo-400)",
            "--tw-prose-captions": "var(--color-slate-500)",
            "--tw-prose-code": "var(--color-indigo-700)",
            "--tw-prose-pre-code": "var(--color-slate-700)",
            "--tw-prose-pre-bg": "var(--color-blue-50)",
            "--tw-prose-th-borders": "var(--color-slate-200)",
            "--tw-prose-td-borders": "var(--color-slate-200)",
            "--tw-prose-invert-body": "var(--color-slate-300)",
            "--tw-prose-invert-headings": "var(--color-slate-100)",
            "--tw-prose-invert-lead": "var(--color-slate-400)",
            "--tw-prose-invert-links": "var(--color-indigo-300)",
            "--tw-prose-invert-bold": "var(--color-slate-100)",
            "--tw-prose-invert-counters": "var(--color-slate-400)",
            "--tw-prose-invert-bullets": "var(--color-slate-500)",
            "--tw-prose-invert-hr": "var(--color-slate-700)",
            "--tw-prose-invert-quotes": "var(--color-slate-200)",
            "--tw-prose-invert-quote-borders": "var(--color-indigo-400)",
            "--tw-prose-invert-captions": "var(--color-slate-400)",
            "--tw-prose-invert-code": "var(--color-indigo-300)",
            "--tw-prose-invert-pre-code": "var(--color-slate-100)",
            "--tw-prose-invert-pre-bg": "var(--color-slate-800)",
            "--tw-prose-invert-th-borders": "var(--color-slate-700)",
            "--tw-prose-invert-td-borders": "var(--color-slate-800)",
          },
        },
      },
    },
  },
  plugins: [typography],
};

export default config;

import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LLM API Checker (OpenAI + Gemini)",
  description: "A simple local playground to test OpenAI & Gemini API keys, chat, image generation, and benchmark.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}

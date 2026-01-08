import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "BasePosting",
  description: "Apify → GPT: generate Base-focused banger posts that feel human.",
  metadataBase: new URL("https://baseposting.online/"),
  openGraph: {
    title: "BasePosting",
    description: "Apify → GPT: generate Base-focused banger posts that feel human.",
    url: "https://baseposting.online/",
    images: ["https://baseposting.online/assets/hero-1200x630.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="fc:miniapp" content='{"version":"1","imageUrl":"https://baseposting.online/assets/embed-3x2.png","button":{"title":"BasePosting","action":{"type":"launch_frame","name":"BasePosting","url":"https://baseposting.online/","splashImageUrl":"https://baseposting.online/assets/splash-200.png","splashBackgroundColor":"#0b0b0f"}}}' />
        <meta name="fc:frame" content='{"version":"1","imageUrl":"https://baseposting.online/assets/embed-3x2.png","button":{"title":"BasePosting","action":{"type":"launch_frame","name":"BasePosting","url":"https://baseposting.online/","splashImageUrl":"https://baseposting.online/assets/splash-200.png","splashBackgroundColor":"#0b0b0f"}}}' />
        <script type="module" src="https://baseposting.online/builderCodeAttribution.mjs"></script>
      </head>
      <body>
        <ThemeProvider>
          {children}
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}

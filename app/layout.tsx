import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "BasePosting",
  description: "Generate unique Base bangers from live X posts.",
  metadataBase: new URL("https://baseposting.online/"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="fc:miniapp" content='{"version":"1","imageUrl":"https://baseposting.online/assets/embed-3x2.png","button":{"title":"Generate banger","action":{"type":"launch_frame","name":"BasePosting","url":"https://baseposting.online/","splashImageUrl":"https://baseposting.online/assets/splash-200.png","splashBackgroundColor":"#09090b"}}}' />
        <meta name="fc:frame" content='{"version":"1","imageUrl":"https://baseposting.online/assets/embed-3x2.png","button":{"title":"Generate banger","action":{"type":"launch_frame","name":"BasePosting","url":"https://baseposting.online/","splashImageUrl":"https://baseposting.online/assets/splash-200.png","splashBackgroundColor":"#09090b"}}}' />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#09090b" />
        <link rel="icon" href="https://baseposting.online/assets/icon-1024.png" />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Toaster richColors position="top-center" />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

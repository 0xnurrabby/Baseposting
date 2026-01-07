import type { AppProps } from "next/app";
import "../styles/globals.css";
import { Toaster } from "sonner";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Component {...pageProps} />
      <Toaster richColors position="top-center" />
      <div className="scanline">
        <div className="animate-scan" />
      </div>
    </>
  );
}

import Document, { Html, Head, Main, NextScript } from "next/document";

export default class MyDocument extends Document {
  render() {
    return (
      <Html lang="en">
        <Head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
          <meta name="theme-color" content="#060B12" />
          <link rel="icon" href="/assets/icon-1024.png" />
          <link rel="preconnect" href="https://auth.farcaster.xyz" />
          <link rel="preconnect" href="https://api.apify.com" />
          <link rel="preconnect" href="https://api.openai.com" />

          <script
            id="fc-raw-embed"
            dangerouslySetInnerHTML={
              __html: `</script><meta name="fc:miniapp" content='{"version":"1","imageUrl":"https://baseposting.online/assets/embed-3x2.png","button":{"title":"Open Base Post Generator","action":{"type":"launch_frame","name":"Base Post Generator","url":"https://baseposting.online/","splashImageUrl":"https://baseposting.online/assets/splash-200.png","splashBackgroundColor":"#060B12"}}}' /><meta name="fc:frame" content='{"version":"1","imageUrl":"https://baseposting.online/assets/embed-3x2.png","button":{"title":"Open Base Post Generator","action":{"type":"launch_frame","name":"Base Post Generator","url":"https://baseposting.online/","splashImageUrl":"https://baseposting.online/assets/splash-200.png","splashBackgroundColor":"#060B12"}}}' /><script>`
            }
          />

          <script type="module" src="/sdk/attribution.js" />
        </Head>
        <body className="crt-overlay">
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

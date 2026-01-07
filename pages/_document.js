import Document, { Html, Head, Main, NextScript } from "next/document";

const FC_EMBED_JSON = "{\"version\":\"next\",\"imageUrl\":\"https://baseposting.online/assets/embed-3x2.png\",\"button\":{\"title\":\"Open Base Post Generator\",\"action\":{\"type\":\"launch_frame\",\"name\":\"Base Post Generator\",\"url\":\"https://baseposting.online/\"}}}";

export default class MyDocument extends Document {{
  render() {{
    return (
      <Html lang="en">
        <Head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
          <meta name="theme-color" content="#070a0f" />
          <meta name="description" content="Base Post Generator — terminal-themed GPT post variants from your Apify X feed." />
          <link rel="icon" href="/assets/icon.png" />

          {{/* Farcaster Mini App / Frame embed tags (VALID JSON) */}}
          <meta name="fc:miniapp" content={{FC_EMBED_JSON}} />
          <meta name="fc:frame" content={{FC_EMBED_JSON}} />
        </Head>
        <body>
          <div className="crtGlow" />
          <div className="scanlines" />
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }}
}}

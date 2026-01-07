// pages/_document.tsx
import Document, { Html, Head, Main, NextScript } from "next/document";

const DOMAIN = "https://baseposting.online";

const FC_JSON =
  `{"version":"1","imageUrl":"${DOMAIN}/assets/embed-3x2.png","button":{"title":"Open Base Post Generator","action":{"type":"launch_frame","name":"Base Post Generator","url":"${DOMAIN}/","splashImageUrl":"${DOMAIN}/assets/splash-200.png","splashBackgroundColor":"#060B12"}}}`;

export default class MyDocument extends Document {
  render() {
    return (
      <Html lang="en">
        <Head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
          <meta name="theme-color" content="#060B12" />
          <link rel="icon" href="/assets/icon-1024.png" />

          {/* Raw inject meta tags without &quot; escaping (miniapp detection strict) */}
          <script
            id="fc-raw-embed"
            dangerouslySetInnerHTML={{
              __html:
                `</script>` +
                `<meta name="fc:miniapp" content='${FC_JSON}' />` +
                `<meta name="fc:frame" content='${FC_JSON}' />` +
                `<script>`,
            }}
          />

          {/* Builder attribution script (local public) */}
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

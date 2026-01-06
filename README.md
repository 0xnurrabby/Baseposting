# LLM API Checker (OpenAI + Gemini)

এই টুল দিয়ে আপনি খুব সহজে:
- OpenAI / Gemini **API key** টেস্ট করতে পারবেন
- Model list দেখতে পারবেন
- ChatGPT-এর মতো **Chat playground** চালাতে পারবেন (coding, JSON, reasoning)
- **Image generation** টেস্ট করতে পারবেন
- Built-in **Benchmark** চালিয়ে latency / success rate / simple quality score দেখতে পারবেন

> **Security**: আপনার API key শুধু আপনার লোকাল মেশিনে থাকবে। এই অ্যাপটা আপনার কম্পিউটারেই রান করবে।

---

## 1) Requirements
- Node.js 18+ (recommended: 20+)
- npm (Node এর সাথে আসে)

---

## 2) Setup (একদম সহজ)
1. এই প্রজেক্ট folder এ ঢুকুন
2. Install:
   ```bash
   npm install
   ```
3. Run:
   ```bash
   npm run dev
   ```
4. Browser এ খুলুন:
   - http://localhost:3000

---

## 3) How to use
1. Provider select করুন (OpenAI / Gemini)
2. API key paste করুন
3. **Test Key & Load** চাপুন
4. Model select করুন
5. Tab থেকে:
   - **Chat**: normal chat / coding / JSON check
   - **Image**: prompt দিয়ে image generate
   - **Benchmark**: Run Benchmark দিয়ে score + metrics

---

## 4) Notes / Common Issues
### OpenAI
- Chat মডেল হিসেবে: `gpt-4.1-mini` বা আপনার অ্যাকাউন্টে যেটা আছে সেটা নিন
- Image: এই প্রজেক্ট `gpt-image-1` ব্যবহার করে

### Gemini
- Chat মডেল: `gemini-1.5-flash`/`gemini-1.5-pro` টাইপ
- Image: Imagen model লাগে (example: `imagen-3.0-generate-001`) — আপনার অ্যাকাউন্ট/region অনুযায়ী বদলাতে পারে

---

## 5) Expand (আপনার চাওয়া মতো বড় করা)
- Side-by-side compare (OpenAI vs Gemini same prompt)
- Streaming responses UI
- Bigger benchmark suite (unit tests, JSON schema validation, etc.)


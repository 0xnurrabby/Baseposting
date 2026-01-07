const OpenAI = require("openai");

function client() {
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY env var.");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

module.exports = { client };

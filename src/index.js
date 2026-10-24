import { CONFIG } from './config.js';
import { createServer } from './server.js';
import { accountManager } from './auth.js';

const app = createServer();

app.listen(CONFIG.PORT, CONFIG.HOST, () => {
  const accounts = accountManager.getAccounts();

  console.log(`
===================================================================
🚀 Antigravity Gemini to Local OpenAI API Proxy
===================================================================
📍 Local OpenAI Base URL : http://${CONFIG.HOST}:${CONFIG.PORT}/v1
🌐 Web Dashboard / Status : http://${CONFIG.HOST}:${CONFIG.PORT}/
🔑 Link New Account       : http://${CONFIG.HOST}:${CONFIG.PORT}/oauth/login
👥 Connected Accounts     : ${accounts.length} account(s)
${accounts.map(a => `   - ${a.email} (${a.projectId})`).join('\n')}
-------------------------------------------------------------------
📋 Supported Models:
${CONFIG.MODELS.map(m => `   - ${m.id} (${m.name})`).join('\n')}
===================================================================
💡 Config for Kilo Code (~/.config/kilo/kilo.jsonc):
{
  "provider": {
    "aygfree": {
      "name": "AYGFree",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://${CONFIG.HOST}:${CONFIG.PORT}/v1",
        "apiKey": "sk-local-antigravity"
      },
      "models": {
        "gemini-3.8-flash-high": {
          "name": "Gemini 3.8 Flash High (AYGFree)",
          "reasoning": true,
          "attachment": true,
          "modalities": { "input": ["text", "image", "pdf"] }
        },
        "claude-opus-5-5-high": {
          "name": "Claude Opus 5.5 High (AYGFree)",
          "reasoning": true,
          "attachment": true,
          "modalities": { "input": ["text", "image", "pdf"] }
        },
        "claude-sonnet-5-5-high": {
          "name": "Claude Sonnet 5.5 High (AYGFree)",
          "reasoning": true,
          "attachment": true,
          "modalities": { "input": ["text", "image", "pdf"] }
        }
      }
    }
  }
}
===================================================================
`);
});

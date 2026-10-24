import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from './config.js';
import { accountManager } from './auth.js';
import { Adapter } from './adapter.js';
import { metricsTracker } from './metrics.js';
import { skillManager } from './skills.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // Static Assets for Web UI Dashboard
  app.use(express.static(path.resolve(__dirname, '../public')));

  // Health / Status JSON API
  app.get('/api/status', (req, res) => {
    res.json({
      name: 'Antigravity Gemini to Local OpenAI API',
      version: '1.0.0',
      status: 'running',
      endpoints: {
        models: '/v1/models',
        chatCompletions: '/v1/chat/completions',
        accounts: '/api/accounts',
        addAccount: '/oauth/login',
        metrics: '/api/metrics',
        skills: '/api/skills'
      },
      accountsCount: accountManager.getAccounts().length,
      skillsCount: skillManager.listSkills().length,
      metrics: metricsTracker.getSummary(accountManager).overview,
      models: CONFIG.MODELS.map(m => m.id)
    });
  });

  // Metrics & Quota Tracker API
  app.get('/api/metrics', (req, res) => {
    res.json(metricsTracker.getSummary(accountManager));
  });

  app.post('/api/metrics/reset', (req, res) => {
    metricsTracker.reset();
    res.json({ success: true, message: 'Metrics reset successfully' });
  });

  // Skills Management API
  app.get('/api/skills', (req, res) => {
    try {
      res.json({
        skillsDir: skillManager.skillsDir,
        skills: skillManager.listSkills()
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/skills/:id', (req, res) => {
    try {
      const skill = skillManager.getSkill(req.params.id);
      res.json({ skill });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  app.post('/api/skills', (req, res) => {
    try {
      const { id, name, description, content } = req.body;
      if (!name && !id) {
        return res.status(400).json({ error: 'Skill name or id is required' });
      }
      const skill = skillManager.saveSkill(id || name, { name, description, content: content || '' });
      res.json({ success: true, skill });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/skills/:id', (req, res) => {
    try {
      const { name, description, content } = req.body;
      const skill = skillManager.saveSkill(req.params.id, { name, description, content: content || '' });
      res.json({ success: true, skill });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/skills/:id', (req, res) => {
    try {
      const result = skillManager.deleteSkill(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Account Management API
  app.get('/api/accounts', (req, res) => {
    res.json({
      accounts: accountManager.getAccounts()
    });
  });

  // Google OAuth Login
  app.get('/oauth/login', (req, res) => {
    const authUrl = accountManager.getAuthorizationUrl();
    res.redirect(authUrl);
  });

  // Google OAuth Callback
  app.get('/oauth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
      return res.status(400).send('<h3>Error: Missing authorization code.</h3>');
    }

    try {
      const acc = await accountManager.handleOAuthCallback(code);
      res.send(`
        <html>
          <body style="font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 90vh;">
            <div style="padding: 30px; border-radius: 12px; background: #f0fdf4; border: 1px solid #86efac; text-align: center;">
              <h2 style="color: #166534; margin: 0 0 10px 0;">Google Antigravity Linked Successfully!</h2>
              <p style="color: #15803d; margin: 0;">Connected Account: <b>${acc.email}</b></p>
              <p style="color: #64748b; font-size: 13px; margin-top: 15px;">You can now close this tab and start using the API.</p>
            </div>
          </body>
        </html>
      `);
    } catch (err) {
      res.status(500).send(`<h3>Authentication Failed: ${err.message}</h3>`);
    }
  });

  // OpenAI: List Models
  app.get('/v1/models', (req, res) => {
    const modelsData = CONFIG.MODELS.map(m => ({
      id: m.id,
      object: 'model',
      created: 1730000000,
      owned_by: 'google-antigravity',
      permission: [],
      root: m.id,
      parent: null
    }));

    // Also support aliases with "ag/" prefix
    for (const m of CONFIG.MODELS) {
      modelsData.push({
        id: `ag/${m.id}`,
        object: 'model',
        created: 1730000000,
        owned_by: 'google-antigravity',
        permission: [],
        root: m.id,
        parent: null
      });
    }

    res.json({
      object: 'list',
      data: modelsData
    });
  });

  // OpenAI: Chat Completions
  app.post('/v1/chat/completions', async (req, res) => {
    const completionId = `chatcmpl-${crypto.randomBytes(12).toString('hex')}`;
    const rawModel = req.body.model || 'gemini-3.8-flash-high';
    const cleanModel = rawModel.startsWith('ag/') ? rawModel.slice(3) : rawModel;
    const isStream = req.body.stream !== false;

    metricsTracker.recordStart(completionId, {
      model: rawModel,
      account: 'pending',
      stream: isStream
    });

    const modelDef = CONFIG.MODELS.find(m => m.id === cleanModel);
    const upstreamCandidates = Array.isArray(modelDef?.upstream)
      ? modelDef.upstream
      : [modelDef?.upstream || cleanModel];

    let retries = 2;
    let success = false;
    let cloudRes = null;

    while (retries >= 0 && !success) {
      try {
        const { accessToken, projectId, email } = await accountManager.getValidToken();
        const activeEntry = metricsTracker.activeMap.get(completionId);
        if (activeEntry) activeEntry.account = email;

        for (const candidateModel of upstreamCandidates) {
          for (const baseUrl of [CONFIG.API.BASE_URL, CONFIG.API.FALLBACK_BASE_URL]) {
            const cloudReq = Adapter.openaiToCloudCode({ ...req.body, model: candidateModel }, projectId);
            cloudRes = await fetch(`${baseUrl}/v1internal:streamGenerateContent?alt=sse`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'User-Agent': CONFIG.API.USER_AGENT
              },
              body: JSON.stringify(cloudReq)
            });

            if (cloudRes.ok) {
              success = true;
              break;
            } else if (cloudRes.status === 404) {
              // Try next candidate or next baseUrl
              continue;
            } else {
              break;
            }
          }
          if (success) break;
        }

        if (!cloudRes || !cloudRes.ok) {
          const errText = cloudRes ? await cloudRes.text() : 'No response';
          console.error(`[API] CloudCode error ${cloudRes?.status} for ${email}:`, errText.substring(0, 300));

          if (cloudRes?.status === 429) {
            accountManager.markCooldown(email, 60000);
            retries--;
            continue;
          }

          if (cloudRes?.status === 401) {
            const acc = accountManager.accounts.find(a => a.email === email);
            if (acc) await accountManager.refreshToken(acc);
            retries--;
            continue;
          }

          metricsTracker.recordComplete(completionId, {
            status: 'error',
            error: `HTTP ${cloudRes?.status}: ${errText.substring(0, 150)}`
          });

          return res.status(cloudRes?.status || 500).json({
            error: {
              message: `Upstream CloudCode error: ${errText}`,
              type: 'upstream_error',
              code: cloudRes?.status || 500
            }
          });
        }

        if (isStream) {
          // SSE Stream Response
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no');

          const reader = cloudRes.body.getReader();
          const decoder = new TextDecoder();
          let lineBuffer = '';
          let lastUsage = null;

          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;

              lineBuffer += decoder.decode(value, { stream: true });
              const lines = lineBuffer.split('\n');
              lineBuffer = lines.pop() || '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('data:')) {
                  const jsonStr = trimmed.slice(5).trim();
                  if (jsonStr && jsonStr !== '[DONE]') {
                    try {
                      const parsed = JSON.parse(jsonStr);
                      if (parsed.response?.usageMetadata) {
                        lastUsage = parsed.response.usageMetadata;
                      }
                      const openaiChunk = Adapter.cloudCodeChunkToOpenAI(parsed, rawModel, completionId);
                      if (openaiChunk) {
                        metricsTracker.recordFirstToken(completionId);
                        res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
                      }
                    } catch (e) {
                      // Skip invalid json
                    }
                  }
                }
              }
            }

            if (lastUsage) {
              const usageChunk = {
                id: completionId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: rawModel,
                choices: [],
                usage: {
                  prompt_tokens: lastUsage.promptTokenCount || 0,
                  completion_tokens: lastUsage.candidatesTokenCount || 0,
                  total_tokens: lastUsage.totalTokenCount || 0,
                  prompt_tokens_details: {
                    cached_tokens: lastUsage.cachedContentTokenCount || 0
                  }
                }
              };
              res.write(`data: ${JSON.stringify(usageChunk)}\n\n`);
            }

            res.write('data: [DONE]\n\n');
            res.end();
            metricsTracker.recordComplete(completionId, {
              usage: lastUsage,
              status: 'success'
            });
          } catch (streamErr) {
            console.error('[API] Stream error:', streamErr.message);
            metricsTracker.recordComplete(completionId, {
              status: 'error',
              error: streamErr.message
            });
            res.end();
          }
        } else {
          // Non-Streaming Response
          const reader = cloudRes.body.getReader();
          const decoder = new TextDecoder();
          let fullBody = '';
          const chunks = [];

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            fullBody += decoder.decode(value, { stream: true });
          }

          const lines = fullBody.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data:')) {
              const jsonStr = trimmed.slice(5).trim();
              if (jsonStr && jsonStr !== '[DONE]') {
                try {
                  chunks.push(JSON.parse(jsonStr));
                } catch (e) {}
              }
            }
          }

          const responseObj = Adapter.cloudCodeToOpenAIResponse(chunks, rawModel, completionId);
          res.json(responseObj);
          metricsTracker.recordComplete(completionId, {
            usage: responseObj.usage,
            status: 'success'
          });
        }

      } catch (err) {
        console.error('[API] Request failed:', err.message);
        retries--;
        if (retries < 0) {
          metricsTracker.recordComplete(completionId, {
            status: 'error',
            error: err.message
          });
          return res.status(500).json({
            error: {
              message: err.message,
              type: 'internal_server_error'
            }
          });
        }
      }
    }
  });

  return app;
}

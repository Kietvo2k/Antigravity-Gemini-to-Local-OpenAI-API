import fs from 'fs';
import crypto from 'crypto';
import { CONFIG } from './config.js';

class AccountManager {
  constructor() {
    this.accounts = [];
    this.currentIndex = 0;
    this.cooldowns = new Map(); // email -> cooldownUntil timestamp
    this.loadAccounts();
  }

  loadAccounts() {
    try {
      if (fs.existsSync(CONFIG.ACCOUNTS_FILE)) {
        const raw = fs.readFileSync(CONFIG.ACCOUNTS_FILE, 'utf-8');
        this.accounts = JSON.parse(raw);
        console.log(`[Auth] Loaded ${this.accounts.length} Google Antigravity account(s).`);
      } else {
        console.warn(`[Auth] No ${CONFIG.ACCOUNTS_FILE} found. You can add accounts via /oauth/login.`);
        this.accounts = [];
      }
    } catch (err) {
      console.error('[Auth] Failed to load accounts.json:', err.message);
      this.accounts = [];
    }
  }

  saveAccounts() {
    try {
      fs.writeFileSync(CONFIG.ACCOUNTS_FILE, JSON.stringify(this.accounts, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Auth] Failed to save accounts.json:', err.message);
    }
  }

  getAccounts() {
    return this.accounts.map(acc => ({
      email: acc.email,
      name: acc.name,
      projectId: acc.projectId || CONFIG.API.DEFAULT_PROJECT,
      isCooldown: (this.cooldowns.get(acc.email) || 0) > Date.now(),
      cooldownSeconds: Math.max(0, Math.ceil(((this.cooldowns.get(acc.email) || 0) - Date.now()) / 1000))
    }));
  }

  markCooldown(email, durationMs = 60000) {
    console.warn(`[Auth] Account ${email} marked cooldown for ${durationMs / 1000}s`);
    this.cooldowns.set(email, Date.now() + durationMs);
  }

  async refreshToken(acc) {
    if (!acc.refreshToken) {
      throw new Error(`Account ${acc.email} missing refreshToken`);
    }

    console.log(`[Auth] Refreshing access token for ${acc.email}...`);
    const params = new URLSearchParams({
      client_id: CONFIG.OAUTH.CLIENT_ID,
      client_secret: CONFIG.OAUTH.CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: acc.refreshToken
    });

    const res = await fetch(CONFIG.OAUTH.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Token refresh failed (${res.status}): ${err}`);
    }

    const data = await res.json();
    acc.accessToken = data.access_token;
    acc.expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
    this.saveAccounts();
    console.log(`[Auth] Access token refreshed for ${acc.email}.`);
    return acc.accessToken;
  }

  async getValidToken() {
    if (this.accounts.length === 0) {
      throw new Error('No Google Antigravity accounts configured. Visit /oauth/login to link an account.');
    }

    const now = Date.now();
    const available = this.accounts.filter(a => (this.cooldowns.get(a.email) || 0) <= now);
    const pool = available.length > 0 ? available : this.accounts;

    let lastError = null;
    for (let i = 0; i < pool.length; i++) {
      this.currentIndex = (this.currentIndex + 1) % pool.length;
      const acc = pool[this.currentIndex];

      try {
        const expiresMs = acc.expiresAt ? new Date(acc.expiresAt).getTime() : 0;
        if (!acc.accessToken || expiresMs - now < 5 * 60 * 1000) {
          await this.refreshToken(acc);
        }
        return {
          accessToken: acc.accessToken,
          projectId: acc.projectId || CONFIG.API.DEFAULT_PROJECT,
          email: acc.email
        };
      } catch (err) {
        lastError = err;
        console.warn(`[Auth] Account ${acc.email} token error: ${err.message}. Trying next account...`);
        this.markCooldown(acc.email, 3600000); // 1 hour cooldown for invalid account
      }
    }

    throw lastError || new Error('No valid tokens available across accounts');
  }

  getAuthorizationUrl() {
    const params = new URLSearchParams({
      client_id: CONFIG.OAUTH.CLIENT_ID,
      redirect_uri: CONFIG.OAUTH.REDIRECT_URI,
      response_type: 'code',
      scope: CONFIG.OAUTH.SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent'
    });
    return `${CONFIG.OAUTH.AUTH_URL}?${params.toString()}`;
  }

  async handleOAuthCallback(code) {
    const params = new URLSearchParams({
      client_id: CONFIG.OAUTH.CLIENT_ID,
      client_secret: CONFIG.OAUTH.CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: CONFIG.OAUTH.REDIRECT_URI
    });

    const tokenRes = await fetch(CONFIG.OAUTH.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`OAuth token exchange failed: ${err}`);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;

    // Fetch user profile info
    let email = 'unknown@google.com';
    let name = 'Google User';
    try {
      const userRes = await fetch(CONFIG.OAUTH.USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (userRes.ok) {
        const userData = await userRes.json();
        email = userData.email || email;
        name = userData.name || name;
      }
    } catch (e) {
      console.warn('[Auth] Failed to fetch userinfo:', e.message);
    }

    // Verify / load CodeAssist project
    let projectId = CONFIG.API.DEFAULT_PROJECT;
    try {
      const loadRes = await fetch(`${CONFIG.API.FALLBACK_BASE_URL}/v1internal:loadCodeAssist`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': CONFIG.API.USER_AGENT
        },
        body: JSON.stringify({
          metadata: {
            ideType: 'IDE_UNSPECIFIED',
            platform: 'PLATFORM_UNSPECIFIED',
            pluginType: 'GEMINI'
          }
        })
      });
      if (loadRes.ok) {
        const loadData = await loadRes.json();
        if (loadData.cloudaicompanionProject) {
          projectId = loadData.cloudaicompanionProject;
        }
      }
    } catch (e) {
      console.warn('[Auth] loadCodeAssist error:', e.message);
    }

    const existingIdx = this.accounts.findIndex(a => a.email === email);
    const accountObj = {
      id: existingIdx !== -1 ? this.accounts[existingIdx].id : crypto.randomUUID(),
      name,
      email,
      accessToken,
      refreshToken: refreshToken || (existingIdx !== -1 ? this.accounts[existingIdx].refreshToken : null),
      expiresAt: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
      projectId
    };

    if (existingIdx !== -1) {
      this.accounts[existingIdx] = accountObj;
    } else {
      this.accounts.push(accountObj);
    }

    this.saveAccounts();
    console.log(`[Auth] Account ${email} successfully saved.`);
    return accountObj;
  }

  async revokeAccount(email) {
    const acc = this.accounts.find(a => a.email === email);
    if (!acc) {
      throw new Error(`Account ${email} not found.`);
    }

    // Try Google OAuth token revocation
    const tokenToRevoke = acc.refreshToken || acc.accessToken;
    if (tokenToRevoke) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokenToRevoke)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        console.log(`[Auth] Revoked OAuth token on Google server for ${email}`);
      } catch (err) {
        console.warn(`[Auth] Google OAuth revoke warning for ${email}:`, err.message);
      }
    }

    this.accounts = this.accounts.filter(a => a.email !== email);
    this.cooldowns.delete(email);
    this.saveAccounts();
    console.log(`[Auth] Account ${email} deleted from accounts list.`);
    return { success: true, email };
  }

  async testAccount(email, modelId = 'gemini-3.8-flash-high') {
    const acc = this.accounts.find(a => a.email === email);
    if (!acc) {
      return {
        email,
        model: modelId,
        success: false,
        status: 404,
        error: `Account ${email} not found.`,
        latencyMs: 0
      };
    }

    const now = Date.now();
    const expiresMs = acc.expiresAt ? new Date(acc.expiresAt).getTime() : 0;
    try {
      if (!acc.accessToken || expiresMs - now < 5 * 60 * 1000) {
        await this.refreshToken(acc);
      }
    } catch (err) {
      return {
        email,
        model: modelId,
        success: false,
        status: 401,
        error: `Token refresh failed: ${err.message}`,
        latencyMs: 0
      };
    }

    const modelDef = CONFIG.MODELS.find(m => m.id === modelId);
    const upstreamCandidates = Array.isArray(modelDef?.upstream)
      ? modelDef.upstream
      : [modelDef?.upstream || modelId];

    const startTime = Date.now();
    let lastError = null;
    let lastStatus = 500;

    for (const candidateModel of upstreamCandidates) {
      for (const baseUrl of [CONFIG.API.BASE_URL, CONFIG.API.FALLBACK_BASE_URL]) {
        try {
          const cloudReq = {
            project: acc.projectId || CONFIG.API.DEFAULT_PROJECT,
            model: candidateModel,
            userAgent: 'antigravity',
            requestId: `test-${crypto.randomUUID()}`,
            request: {
              contents: [{ role: 'user', parts: [{ text: 'say ok' }] }],
              generationConfig: { maxOutputTokens: 5 }
            }
          };

          const res = await fetch(`${baseUrl}/v1internal:streamGenerateContent?alt=sse`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${acc.accessToken}`,
              'Content-Type': 'application/json',
              'User-Agent': CONFIG.API.USER_AGENT
            },
            body: JSON.stringify(cloudReq)
          });

          lastStatus = res.status;
          if (res.ok) {
            const latencyMs = Date.now() - startTime;
            return {
              email,
              model: modelId,
              candidateModel,
              success: true,
              status: 200,
              latencyMs
            };
          }

          const errText = await res.text();
          lastError = errText;
          if (res.status === 404) {
            continue; // try next candidate/baseUrl
          }
          break; // other error, break out of baseUrl loop
        } catch (e) {
          lastError = e.message;
        }
      }
    }

    const latencyMs = Date.now() - startTime;
    return {
      email,
      model: modelId,
      success: false,
      status: lastStatus,
      error: lastError ? lastError.substring(0, 300) : 'Unknown error',
      latencyMs
    };
  }

  async testAccountMatrix(models = null) {
    const targetModels = models && Array.isArray(models) && models.length > 0
      ? models
      : ['gemini-4-argon', 'gemini-3.8-flash-high', 'claude-opus-5-5-high', 'claude-sonnet-5-5-high'];

    const matrixResults = [];
    for (const acc of this.accounts) {
      const accResults = [];
      for (const modelId of targetModels) {
        const res = await this.testAccount(acc.email, modelId);
        accResults.push(res);
      }
      matrixResults.push({
        email: acc.email,
        name: acc.name,
        projectId: acc.projectId,
        results: accResults
      });
    }

    return {
      timestamp: new Date().toISOString(),
      models: targetModels,
      matrix: matrixResults
    };
  }
}

export const accountManager = new AccountManager();

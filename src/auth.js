import fs from 'fs';
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

    // Round-robin selection
    this.currentIndex = (this.currentIndex + 1) % pool.length;
    const acc = pool[this.currentIndex];

    // Check expiration (refresh if expires within 5 minutes)
    const expiresMs = acc.expiresAt ? new Date(acc.expiresAt).getTime() : 0;
    if (!acc.accessToken || expiresMs - now < 5 * 60 * 1000) {
      await this.refreshToken(acc);
    }

    return {
      accessToken: acc.accessToken,
      projectId: acc.projectId || CONFIG.API.DEFAULT_PROJECT,
      email: acc.email
    };
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
}

export const accountManager = new AccountManager();

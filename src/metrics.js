export class MetricsTracker {
  constructor() {
    this.totalRequests = 0;
    this.successRequests = 0;
    this.failedRequests = 0;
    this.activeRequests = 0;

    this.tokens = {
      prompt: 0,
      completion: 0,
      cached: 0,
      total: 0
    };

    this.tps = {
      current: 0,
      peak: 0,
      totalWeightedTps: 0,
      tpsCount: 0
    };

    this.latency = {
      totalDurationMs: 0,
      totalTtftMs: 0,
      ttftCount: 0
    };

    this.models = new Map();
    this.accounts = new Map();
    this.recentRequests = [];
    this.activeMap = new Map();
  }

  recordStart(requestId, { model, account, stream }) {
    this.totalRequests++;
    this.activeRequests++;
    const now = Date.now();
    this.activeMap.set(requestId, {
      requestId,
      model,
      account,
      stream,
      startTime: now,
      firstTokenTime: null,
      tokensOutput: 0
    });
  }

  recordFirstToken(requestId) {
    const entry = this.activeMap.get(requestId);
    if (entry && !entry.firstTokenTime) {
      entry.firstTokenTime = Date.now();
    }
  }

  recordComplete(requestId, { usage, status = 'success', error = null }) {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    const entry = this.activeMap.get(requestId);
    const now = Date.now();

    const startTime = entry?.startTime || now;
    const durationMs = Math.max(1, now - startTime);
    const ttftMs = entry?.firstTokenTime ? Math.max(0, entry.firstTokenTime - startTime) : durationMs;

    const promptTokens = usage?.prompt_tokens ?? usage?.promptTokenCount ?? 0;
    const completionTokens = usage?.completion_tokens ?? usage?.candidatesTokenCount ?? 0;
    const cachedTokens = usage?.cached_tokens ?? usage?.prompt_tokens_details?.cached_tokens ?? usage?.cachedContentTokenCount ?? 0;
    const totalTokens = usage?.total_tokens ?? usage?.totalTokenCount ?? (promptTokens + completionTokens);

    const durationSec = durationMs / 1000;
    const tps = completionTokens > 0 && durationSec > 0 ? parseFloat((completionTokens / durationSec).toFixed(1)) : 0;

    if (status === 'success') {
      this.successRequests++;
      this.tokens.prompt += promptTokens;
      this.tokens.completion += completionTokens;
      this.tokens.cached += cachedTokens;
      this.tokens.total += totalTokens;

      if (tps > 0) {
        this.tps.current = tps;
        if (tps > this.tps.peak) this.tps.peak = tps;
        this.tps.totalWeightedTps += tps;
        this.tps.tpsCount++;
      }

      this.latency.totalDurationMs += durationMs;
      if (entry?.firstTokenTime) {
        this.latency.totalTtftMs += ttftMs;
        this.latency.ttftCount++;
      }
    } else {
      this.failedRequests++;
    }

    const modelName = entry?.model || 'unknown';
    const accountEmail = entry?.account || 'unknown';

    // Model stats
    if (!this.models.has(modelName)) {
      this.models.set(modelName, {
        requests: 0,
        success: 0,
        errors: 0,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        totalTokens: 0,
        totalDurationMs: 0,
        totalTps: 0,
        tpsCount: 0,
        lastUsed: now
      });
    }
    const mStats = this.models.get(modelName);
    mStats.requests++;
    mStats.lastUsed = now;
    if (status === 'success') {
      mStats.success++;
      mStats.promptTokens += promptTokens;
      mStats.completionTokens += completionTokens;
      mStats.cachedTokens += cachedTokens;
      mStats.totalTokens += totalTokens;
      mStats.totalDurationMs += durationMs;
      if (tps > 0) {
        mStats.totalTps += tps;
        mStats.tpsCount++;
      }
    } else {
      mStats.errors++;
    }

    // Account stats
    if (!this.accounts.has(accountEmail)) {
      this.accounts.set(accountEmail, {
        requests: 0,
        success: 0,
        errors: 0,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        totalTokens: 0,
        lastUsed: now
      });
    }
    const aStats = this.accounts.get(accountEmail);
    aStats.requests++;
    aStats.lastUsed = now;
    if (status === 'success') {
      aStats.success++;
      aStats.promptTokens += promptTokens;
      aStats.completionTokens += completionTokens;
      aStats.cachedTokens += cachedTokens;
      aStats.totalTokens += totalTokens;
    } else {
      aStats.errors++;
    }

    // Recent requests log
    this.recentRequests.unshift({
      id: requestId,
      time: new Date(now).toISOString(),
      model: modelName,
      account: accountEmail,
      stream: entry?.stream ?? false,
      promptTokens,
      completionTokens,
      cachedTokens,
      totalTokens,
      durationMs,
      ttftMs,
      tps,
      status,
      error
    });

    if (this.recentRequests.length > 100) {
      this.recentRequests.pop();
    }

    this.activeMap.delete(requestId);
  }

  getSummary(accountManager = null) {
    const avgTps = this.tps.tpsCount > 0 ? parseFloat((this.tps.totalWeightedTps / this.tps.tpsCount).toFixed(1)) : 0;
    const avgLatency = this.successRequests > 0 ? Math.round(this.latency.totalDurationMs / this.successRequests) : 0;
    const avgTtft = this.latency.ttftCount > 0 ? Math.round(this.latency.totalTtftMs / this.latency.ttftCount) : 0;

    const modelList = Array.from(this.models.entries()).map(([id, s]) => ({
      id,
      requests: s.requests,
      success: s.success,
      errors: s.errors,
      promptTokens: s.promptTokens,
      completionTokens: s.completionTokens,
      cachedTokens: s.cachedTokens,
      totalTokens: s.totalTokens,
      avgTps: s.tpsCount > 0 ? parseFloat((s.totalTps / s.tpsCount).toFixed(1)) : 0,
      avgDurationMs: s.success > 0 ? Math.round(s.totalDurationMs / s.success) : 0,
      lastUsed: s.lastUsed
    }));

    const accountList = [];
    if (accountManager) {
      for (const acc of accountManager.getAccounts()) {
        const stats = this.accounts.get(acc.email) || {
          requests: 0,
          success: 0,
          errors: 0,
          promptTokens: 0,
          completionTokens: 0,
          cachedTokens: 0,
          totalTokens: 0,
          lastUsed: null
        };
        accountList.push({
          email: acc.email,
          projectId: acc.projectId,
          status: acc.status,
          cooldownRemainingSec: acc.cooldownRemainingSec,
          expiresAt: acc.expiresAt,
          ...stats
        });
      }
    }

    return {
      overview: {
        totalRequests: this.totalRequests,
        activeRequests: this.activeRequests,
        successRequests: this.successRequests,
        failedRequests: this.failedRequests,
        tokens: this.tokens,
        tps: {
          current: this.tps.current,
          peak: this.tps.peak,
          average: avgTps
        },
        latency: {
          avgDurationMs: avgLatency,
          avgTtftMs: avgTtft
        }
      },
      models: modelList,
      accounts: accountList,
      recentRequests: this.recentRequests
    };
  }

  reset() {
    this.totalRequests = 0;
    this.successRequests = 0;
    this.failedRequests = 0;
    this.tokens = { prompt: 0, completion: 0, cached: 0, total: 0 };
    this.tps = { current: 0, peak: 0, totalWeightedTps: 0, tpsCount: 0 };
    this.latency = { totalDurationMs: 0, totalTtftMs: 0, ttftCount: 0 };
    this.models.clear();
    this.accounts.clear();
    this.recentRequests = [];
    this.activeMap.clear();
  }
}

export const metricsTracker = new MetricsTracker();

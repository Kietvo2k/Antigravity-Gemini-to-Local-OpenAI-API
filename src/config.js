import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CONFIG = {
  PORT: parseInt(process.env.PORT || '8045', 10),
  HOST: process.env.HOST || '127.0.0.1',
  ACCOUNTS_FILE: path.resolve(__dirname, '../accounts.json'),

  // Google Antigravity OAuth Client
  OAUTH: {
    CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
    CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
    REDIRECT_URI: process.env.REDIRECT_URI || 'http://127.0.0.1:8045/oauth/callback',
    AUTH_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
    TOKEN_URL: 'https://oauth2.googleapis.com/token',
    USERINFO_URL: 'https://www.googleapis.com/oauth2/v1/userinfo',
    SCOPES: [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/cclog',
      'https://www.googleapis.com/auth/experimentsandconfigs'
    ]
  },

  // Google CloudCode Endpoints
  API: {
    USER_AGENT: 'antigravity/hub/2.24.0 windows/amd64',
    BASE_URL: 'https://daily-cloudcode-pa.googleapis.com',
    FALLBACK_BASE_URL: 'https://cloudcode-pa.googleapis.com',
    DEFAULT_PROJECT: 'aicode-consumers'
  },

  // Supported Model Catalog: Only Gemini 3.8 Flash High, Claude Opus 5.5 High, Claude Sonnet 5.5 High
  MODELS: [
    {
      id: 'gemini-3.8-flash-high',
      name: 'Gemini 3.8 Flash High (Reasoning)',
      upstream: ['gemini-3.8-flash-high'],
      contextWindow: 1048576,
      supportsThinking: true
    },
    {
      id: 'claude-opus-5-5-high',
      name: 'Claude Opus 5.5 High (Antigravity)',
      upstream: ['claude-opus-5-5-high', 'claude-opus-4-6-thinking'],
      contextWindow: 200000,
      supportsThinking: true
    },
    {
      id: 'claude-sonnet-5-5-high',
      name: 'Claude Sonnet 5.5 High (Antigravity)',
      upstream: ['claude-sonnet-5-5-high', 'claude-sonnet-4-6'],
      contextWindow: 200000,
      supportsThinking: true
    }
  ]
};

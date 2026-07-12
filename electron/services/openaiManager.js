const { shell } = require('electron');
const crypto = require('crypto');
const http = require('http');
const url = require('url');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * OpenAI ChatGPT OAuth Manager
 * Uses the same OAuth 2.0 + PKCE flow as OpenAI's official Codex CLI.
 * Allows using your ChatGPT Plus/Pro subscription without API keys.
 *
 * Endpoints discovered from: openai/codex & opencode-openai-codex-auth
 */

// ─── OAuth Constants (from OpenAI official Codex CLI) ──────────────────────
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const SCOPE = 'openid profile email offline_access';
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api';

// Token storage path
const TOKENS_PATH = path.join(os.homedir(), '.vibe-ide-coder', 'openai-tokens.json');

// ─── PKCE Helpers ──────────────────────────────────────────────────────────

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

// ─── Token Storage ─────────────────────────────────────────────────────────

function saveTokens(tokens) {
  const dir = path.dirname(TOKENS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2), 'utf8');
}

function loadTokens() {
  try {
    const content = fs.readFileSync(TOKENS_PATH, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function clearTokens() {
  try { fs.unlinkSync(TOKENS_PATH); } catch {}
}

// ─── Token Refresh ─────────────────────────────────────────────────────────

async function refreshAccessToken(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  return res.json();
}

async function getValidToken() {
  const tokens = loadTokens();
  if (!tokens) return null;

  const expiry = tokens.expires_at || 0;
  const now = Math.floor(Date.now() / 1000);

  if (now < expiry - 60) {
    return tokens.access_token;
  }

  if (tokens.refresh_token) {
    try {
      const fresh = await refreshAccessToken(tokens.refresh_token);
      const updated = {
        ...tokens,
        access_token: fresh.access_token,
        expires_at: now + (fresh.expires_in || 3600),
      };
      saveTokens(updated);
      return updated.access_token;
    } catch {
      return null;
    }
  }

  return null;
}

// ─── Status ────────────────────────────────────────────────────────────────

async function getOpenAIStatus() {
  try {
    const authPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');
    if (fs.existsSync(authPath)) {
      const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      if (auth.openai && auth.openai.accessToken) {
        // Try to decode JWT if present to show email
        try {
          const parts = auth.openai.accessToken.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
            return { authenticated: true, email: payload.email || payload.sub || 'OpenAI API' };
          }
        } catch {}
        return { authenticated: true, email: 'OpenAI API' };
      }
    }
  } catch (err) {
    console.error('[OpenAI Status Error]', err);
  }
  return { authenticated: false, email: null };
}

// ─── OAuth Flow ────────────────────────────────────────────────────────────

// ─── Chat with ChatGPT backend ─────────────────────────────────────────────

// ─── ANSI Stripper ──────────────────────────────────────────────────────────

function stripAnsi(str) {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

// ─── Chat with ChatGPT via opencode CLI ──────────────────────────────────────

let activeProcess = null;

async function sendChatMessage(prompt, conversationHistory = [], model = 'gpt-5.4', cwd, mainWindow) {
  return new Promise((resolve) => {
    if (activeProcess) {
      try { activeProcess.kill(); } catch {}
      activeProcess = null;
    }

    const isWin = process.platform === 'win32';
    const opencodeCmd = isWin ? 'opencode.cmd' : 'opencode';
    
    // Prefix the model with openai/ for the opencode CLI
    const prefixedModel = model.startsWith('openai/') ? model : `openai/${model}`;

    const cleanEnv = {
      ...process.env,
      NO_COLOR: '1',
      TERM: 'dumb',
    };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    delete cleanEnv.ELECTRON_NO_ASAR;

    try {
      // Spawn opencode run and pipe the prompt to stdin
      activeProcess = spawn(opencodeCmd, ['run', '-', '--model', prefixedModel], {
        cwd: cwd || process.cwd(),
        env: cleanEnv,
        stdio: 'pipe',
        shell: true,
      });

      // Pass conversation history along with the new prompt
      // opencode handles previous session continuation via flags, but for stateless we just inject history
      let fullPrompt = '';
      for (const msg of conversationHistory) {
        if (msg.role === 'user') fullPrompt += `User: ${msg.content}\n\n`;
        if (msg.role === 'assistant') fullPrompt += `Assistant: ${msg.content}\n\n`;
      }
      fullPrompt += `User: ${prompt}\n`;

      activeProcess.stdin.write(fullPrompt, 'utf8');
      activeProcess.stdin.end();

      let fullOutput = '';

      activeProcess.stdout.on('data', (data) => {
        const text = stripAnsi(data.toString());
        fullOutput += text;
        const win = mainWindow || null;
        if (win && !win.isDestroyed()) win.webContents.send('openai:data', text);
      });

      activeProcess.stderr.on('data', (data) => {
        const text = stripAnsi(data.toString());
        console.log('[openai:stderr]', text);
        if (!text.includes('Warning:') && !text.includes('no stdin')) {
          const win = mainWindow || null;
          if (win && !win.isDestroyed()) win.webContents.send('openai:data', text);
        }
      });

      activeProcess.on('close', (code) => {
        activeProcess = null;
        const win = mainWindow || null;
        if (win && !win.isDestroyed()) win.webContents.send('openai:complete', { code, output: fullOutput });
        resolve({ success: true });
      });

      activeProcess.on('error', (error) => {
        activeProcess = null;
        const win = mainWindow || null;
        if (win && !win.isDestroyed()) win.webContents.send('openai:error', error.message);
        resolve({ success: false, error: error.message });
      });

    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
}

// ─── IPC Setup ─────────────────────────────────────────────────────────────

function setupOpenAIHandlers(ipcMain, getMainWindow) {
  ipcMain.handle('openai:status', async () => {
    return await getOpenAIStatus();
  });

  ipcMain.handle('openai:login', async () => {
    return { success: false, error: 'Login handled via opencode CLI' };
  });

  ipcMain.handle('openai:logout', () => {
    return { success: true };
  });

  ipcMain.handle('openai:send', async (_, prompt, conversationHistory, model, cwd) => {
    const mainWindow = getMainWindow();
    try {
      return await sendChatMessage(prompt, conversationHistory || [], model, cwd, mainWindow);
    } catch (err) {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send('openai:error', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.on('openai:cancel', () => {
    if (activeProcess) {
      try { activeProcess.kill(); } catch {}
      activeProcess = null;
    }
  });
}

module.exports = { setupOpenAIHandlers };

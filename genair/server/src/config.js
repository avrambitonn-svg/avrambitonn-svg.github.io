// Reads every setting from environment variables. Called per request so a
// change in env (tests, Vercel redeploy) is picked up without restarts.

export const VERSION = '0.1.0';

export const PRIORITY_DEMO = Object.freeze({
  // Priority's public sandbox. The credentials are published on Priority's
  // developer portal and are shared by everyone - never write to it.
  serviceRoot: 'https://t.eu.priority-connect.online/odata/Priority/tabbtd38.ini/usdemo',
  user: 'apidemo',
  password: '123',
});

const DEFAULT_ORIGINS = 'http://localhost:5173,http://localhost:4173';
const DEFAULT_AI_MODELS = 'claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5';
const DEFAULT_AI_BETAS = 'server-side-fallback-2026-07-01';
// Current Graph API version per developers.facebook.com/docs/graph-api/changelog/versions
// (v26.0, released 2026-07-29). Override with WHATSAPP_GRAPH_VERSION.
export const DEFAULT_GRAPH_VERSION = 'v26.0';

function list(value, fallback) {
  return String(value ?? fallback ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function str(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  return s || '';
}

function bool(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? '').trim());
}

export function priorityConfig(env = process.env) {
  const raw = str(env.PRIORITY_MODE).toLowerCase();
  const mode = ['off', 'demo', 'live'].includes(raw) ? raw : 'demo';
  const allowWrite = bool(env.PRIORITY_ALLOW_WRITE);
  const appId = str(env.PRIORITY_APP_ID);
  const appKey = str(env.PRIORITY_APP_KEY);

  if (mode === 'off') return { mode, configured: false, allowWrite: false };

  if (mode === 'demo') {
    return {
      mode,
      configured: true,
      allowWrite,
      serviceRoot: PRIORITY_DEMO.serviceRoot,
      user: PRIORITY_DEMO.user,
      password: PRIORITY_DEMO.password,
      appId,
      appKey,
    };
  }

  const serviceRoot = str(env.PRIORITY_URL).replace(/\/+$/, '');
  const pat = str(env.PRIORITY_PAT);
  // A Personal Access Token goes as the Basic username with the literal password "PAT".
  const user = pat || str(env.PRIORITY_USER);
  const password = pat ? 'PAT' : String(env.PRIORITY_PASSWORD ?? '');
  const configured = Boolean(serviceRoot && user && password);
  return { mode, configured, allowWrite, serviceRoot, user, password, appId, appKey };
}

export function loadConfig(env = process.env) {
  const priority = priorityConfig(env);
  return {
    allowedOrigins: list(env.ALLOWED_ORIGINS, DEFAULT_ORIGINS),
    appToken: str(env.APP_TOKEN),
    priority,
    ai: {
      apiKey: str(env.ANTHROPIC_API_KEY),
      allowedModels: list(env.AI_ALLOWED_MODELS, DEFAULT_AI_MODELS),
      allowedBetas: list(env.AI_ALLOWED_BETAS, DEFAULT_AI_BETAS),
      timeoutMs: Number(env.AI_TIMEOUT_MS) > 0 ? Number(env.AI_TIMEOUT_MS) : 300_000,
    },
    whatsapp: {
      token: str(env.WHATSAPP_TOKEN),
      phoneNumberId: str(env.WHATSAPP_PHONE_NUMBER_ID),
      graphVersion: str(env.WHATSAPP_GRAPH_VERSION) || DEFAULT_GRAPH_VERSION,
      verifyToken: str(env.WHATSAPP_VERIFY_TOKEN),
      appSecret: str(env.WHATSAPP_APP_SECRET),
    },
    google: {
      serviceAccountRaw: str(env.GOOGLE_SERVICE_ACCOUNT_JSON),
      calendarId: str(env.GOOGLE_CALENDAR_ID),
      driveParentId: str(env.GOOGLE_DRIVE_PARENT_ID),
      subject: str(env.GOOGLE_SUBJECT),
      driveScope: str(env.GOOGLE_DRIVE_SCOPE) || 'https://www.googleapis.com/auth/drive.file',
    },
  };
}

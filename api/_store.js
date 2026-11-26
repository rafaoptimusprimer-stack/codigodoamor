// Acesso mínimo ao Redis (Upstash / Vercel KV) via REST, sem dependências.
// Variáveis lidas: KV_REST_API_URL + KV_REST_API_TOKEN (ou UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).

function config() {
  return {
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  };
}

export function storeConfigured() {
  const { url, token } = config();
  return Boolean(url && token);
}

async function cmd(args) {
  const { url, token } = config();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });
  const json = await response.json();
  if (!response.ok || json.error) {
    throw new Error(json.error || 'Erro no banco de dados.');
  }
  return json.result;
}

export async function get(key) {
  return cmd(['GET', key]);
}

export async function set(key, value, ttlSeconds) {
  return cmd(['SET', key, String(value), 'EX', String(ttlSeconds)]);
}

// Grava só se a chave ainda não existir (operação atômica). Retorna true se gravou.
export async function setNx(key, value, ttlSeconds) {
  const result = await cmd(['SET', key, String(value), 'NX', 'EX', String(ttlSeconds)]);
  return result === 'OK';
}

// Contador com janela de tempo (usado para limitar tentativas).
export async function hit(key, windowSeconds) {
  const count = await cmd(['INCR', key]);
  if (count === 1) {
    await cmd(['EXPIRE', key, String(windowSeconds)]);
  }
  return count;
}

export async function count(key) {
  const value = await get(key);
  return value ? Number(value) : 0;
}

export function clientIp(req) {
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

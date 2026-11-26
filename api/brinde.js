import crypto from 'crypto';
import { storeConfigured, setNx, hit, count, clientIp } from './_store.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SIG_LENGTH = 16;
const MAX_FAILURES = 10;
const FAILURE_WINDOW = 10 * 60;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

function sign(signingKey, tsHex) {
  return crypto
    .createHmac('sha256', signingKey)
    .update(tsHex)
    .digest('hex')
    .slice(0, SIG_LENGTH)
    .toUpperCase();
}

function signGrant(signingKey, payloadStr) {
  return crypto.createHmac('sha256', signingKey).update(payloadStr).digest('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Variável ADMIN_SECRET não configurada na Vercel.' });
  }
  if (!storeConfigured()) {
    return res.status(500).json({ error: 'Banco de dados (Redis/KV) não configurado na Vercel.' });
  }
  const signingKey = process.env.BRINDE_SIGNING_SECRET || secret;

  const { action, adminPassword, code } = req.body || {};

  try {
    const failKey = `rl:brinde:${clientIp(req)}`;
    if ((await count(failKey)) >= MAX_FAILURES) {
      return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
    }

    if (action === 'generate') {
      if (typeof adminPassword !== 'string' || !adminPassword || !safeEqual(adminPassword, secret)) {
        await hit(failKey, FAILURE_WINDOW);
        return res.status(401).json({ error: 'Senha de administrador incorreta.' });
      }

      const expiresAt = Date.now() + DAY_MS;
      const tsHex = expiresAt.toString(36).toUpperCase();
      const sig = sign(signingKey, tsHex);

      return res.status(200).json({
        code: `AMOR-${tsHex}-${sig}`,
        expiresAt
      });
    }

    if (action === 'redeem') {
      if (!code || typeof code !== 'string' || code.length > 64) {
        return res.status(400).json({ error: 'Digite um código de brinde válido.' });
      }

      const parts = code.trim().toUpperCase().split('-');
      if (parts.length !== 3 || parts[0] !== 'AMOR') {
        await hit(failKey, FAILURE_WINDOW);
        return res.status(400).json({ error: 'Formato de código inválido.' });
      }

      const [, tsHex, providedSig] = parts;
      const expectedSig = sign(signingKey, tsHex);

      if (providedSig.length !== expectedSig.length || !safeEqual(providedSig, expectedSig)) {
        await hit(failKey, FAILURE_WINDOW);
        return res.status(400).json({ error: 'Código de brinde inválido.' });
      }

      const expiresAt = parseInt(tsHex, 36);
      if (!expiresAt || Date.now() > expiresAt) {
        return res.status(400).json({ error: 'Este código expirou (prazo de 24h encerrado).' });
      }
      if (expiresAt > Date.now() + DAY_MS + 60 * 1000) {
        await hit(failKey, FAILURE_WINDOW);
        return res.status(400).json({ error: 'Código de brinde inválido.' });
      }

      const ttl = Math.ceil((expiresAt - Date.now()) / 1000) + 3600;
      const firstUse = await setNx(`brinde:${tsHex}-${providedSig}`, String(Date.now()), ttl);
      if (!firstUse) {
        return res.status(400).json({ error: 'Este código já foi utilizado.' });
      }

      const planDays = 15;
      const exp = Date.now() + planDays * 86400000;
      const giftId = `brinde-${tsHex}-${providedSig}`;
      const grant = {
        paymentId: giftId,
        plan: 'brinde_15_dias',
        exp,
        sig: signGrant(signingKey, `${giftId}:brinde_15_dias:${exp}`)
      };

      return res.status(200).json({ valid: true, planDays, grant });
    }

    return res.status(400).json({ error: 'Ação inválida.' });
  } catch (error) {
    return res.status(500).json({ error: 'Erro interno ao processar o código.' });
  }
}

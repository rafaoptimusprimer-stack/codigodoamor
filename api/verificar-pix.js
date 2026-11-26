import crypto from 'crypto';
import { storeConfigured, get, setNx, hit, count, clientIp } from './_store.js';

const PLAN_CONFIG = {
  '15_dias': { price: 9.90, days: 15 },
  '1_ano': { price: 29.90, days: 365 },
  'vitalicio': { price: 49.90, days: 36500 }
};

const USED_TTL = 30 * 24 * 60 * 60;
const REDELIVERY_WINDOW_MS = 15 * 60 * 1000;
const VERIFY_LIMIT = 60;
const VERIFY_WINDOW = 10 * 60;

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function signGrant(signingKey, payloadStr) {
  return crypto.createHmac('sha256', signingKey).update(payloadStr).digest('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const accessToken = process.env.MP_ACCESS_TOKEN;
  const signingKey = process.env.BRINDE_SIGNING_SECRET || process.env.ADMIN_SECRET;
  if (!accessToken) {
    return res.status(500).json({ error: 'Variável MP_ACCESS_TOKEN não configurada.' });
  }
  if (!signingKey) {
    return res.status(500).json({ error: 'Chave de assinatura não configurada na Vercel.' });
  }
  if (!storeConfigured()) {
    return res.status(500).json({ error: 'Banco de dados (Redis/KV) não configurado na Vercel.' });
  }

  const { id, token } = req.query;
  if (!id || !/^\d{1,20}$/.test(String(id))) {
    return res.status(400).json({ error: 'ID do pagamento inválido.' });
  }
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Token do pagamento não informado.' });
  }

  try {
    const rlKey = `rl:verpix:${clientIp(req)}`;
    if ((await count(rlKey)) >= VERIFY_LIMIT) {
      return res.status(429).json({ error: 'Muitas consultas. Aguarde um momento.' });
    }
    await hit(rlKey, VERIFY_WINDOW);

    const raw = await get(`pix:${id}`);
    if (!raw) {
      return res.status(404).json({ error: 'Pagamento não encontrado.' });
    }
    const record = JSON.parse(raw);
    if (!safeEqual(token, record.token)) {
      return res.status(403).json({ error: 'Token do pagamento inválido.' });
    }

    const response = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Erro ao consultar pagamento.' });
    }

    let status = data.status;
    let grant = null;

    if (status === 'approved') {
      const planInfo = PLAN_CONFIG[record.plan];
      const valid =
        planInfo &&
        data.payment_method_id === 'pix' &&
        typeof data.description === 'string' &&
        data.description.startsWith('Código do Amor') &&
        Number(data.transaction_amount) >= planInfo.price;

      if (!valid) {
        status = 'rejected_mismatch';
      } else {
        const now = Date.now();
        const firstUse = await setNx(`pixused:${id}`, String(now), USED_TTL);
        if (!firstUse) {
          const usedAt = Number(await get(`pixused:${id}`)) || 0;
          if (now - usedAt > REDELIVERY_WINDOW_MS) {
            status = 'already_used';
          }
        }

        if (status === 'approved') {
          const exp = now + planInfo.days * 86400000;
          const payloadStr = `${id}:${record.plan}:${exp}`;
          grant = {
            paymentId: String(id),
            plan: record.plan,
            exp,
            sig: signGrant(signingKey, payloadStr)
          };
        }
      }
    }

    return res.status(200).json({
      id: data.id,
      status,
      plan: status === 'approved' ? record.plan : undefined,
      grant
    });
  } catch (error) {
    return res.status(500).json({ error: 'Erro interno na consulta do Pix.' });
  }
}

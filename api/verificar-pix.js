import crypto from 'crypto';
import { storeConfigured, get, setNx } from './_store.js';

const PLAN_PRICES = {
  '15_dias': 9.90,
  '1_ano': 29.90,
  'vitalicio': 49.90
};

const USED_TTL = 30 * 24 * 60 * 60; // lembra por 30 dias que o pagamento já foi usado
const REDELIVERY_WINDOW_MS = 15 * 60 * 1000; // se a resposta se perder, o mesmo cliente pode repetir por 15 min

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    return res.status(500).json({ error: 'Variável MP_ACCESS_TOKEN não configurada.' });
  }
  if (!storeConfigured()) {
    return res.status(500).json({ error: 'Banco de dados (Redis/KV) não configurado na Vercel.' });
  }

  const { id, token } = req.query;
  if (!id) {
    return res.status(400).json({ error: 'ID do pagamento não informado.' });
  }
  // O ID do Mercado Pago é numérico; evita injetar caminhos na URL da API.
  if (!/^\d{1,20}$/.test(String(id))) {
    return res.status(400).json({ error: 'ID do pagamento inválido.' });
  }
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Token do pagamento não informado.' });
  }

  try {
    // Registro criado junto com o Pix: guarda o segredo do dono e o plano contratado.
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

    if (status === 'approved') {
      const expected = PLAN_PRICES[record.plan];
      const valid =
        data.payment_method_id === 'pix' &&
        typeof data.description === 'string' &&
        data.description.startsWith('Código do Amor') &&
        expected !== undefined &&
        Number(data.transaction_amount) >= expected;

      if (!valid) {
        status = 'rejected_mismatch';
      } else {
        // Cada pagamento libera um único projeto.
        const now = Date.now();
        const firstUse = await setNx(`pixused:${id}`, String(now), USED_TTL);
        if (!firstUse) {
          const usedAt = Number(await get(`pixused:${id}`)) || 0;
          if (now - usedAt > REDELIVERY_WINDOW_MS) {
            status = 'already_used';
          }
        }
      }
    }

    return res.status(200).json({
      id: data.id,
      status,
      plan: status === 'approved' ? record.plan : undefined
    });
  } catch (error) {
    return res.status(500).json({ error: 'Erro interno na consulta do Pix.' });
  }
}

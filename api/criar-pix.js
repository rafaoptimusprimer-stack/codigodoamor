import crypto from 'crypto';
import { storeConfigured, set, hit, count, clientIp } from './_store.js';

const PLANS = {
  '15_dias': { price: 9.90, days: 15, title: 'Código do Amor - Plano 15 Dias' },
  '1_ano': { price: 29.90, days: 365, title: 'Código do Amor - Plano 1 Ano' },
  'vitalicio': { price: 49.90, days: 36500, title: 'Código do Amor - Plano Vitalício' }
};

const PIX_RECORD_TTL = 7 * 24 * 60 * 60;
const CREATE_LIMIT = 20;
const CREATE_WINDOW = 10 * 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    return res.status(500).json({ error: 'Variável MP_ACCESS_TOKEN não configurada na Vercel.' });
  }
  if (!storeConfigured()) {
    return res.status(500).json({ error: 'Banco de dados (Redis/KV) não configurado na Vercel.' });
  }

  try {
    const rlKey = `rl:criarpix:${clientIp(req)}`;
    if ((await count(rlKey)) >= CREATE_LIMIT) {
      return res.status(429).json({ error: 'Muitas solicitações. Aguarde alguns minutos e tente novamente.' });
    }
    await hit(rlKey, CREATE_WINDOW);

    const { planId, coupleName, payerEmail } = req.body || {};
    const selectedPlan = PLANS[planId];
    if (!selectedPlan) {
      return res.status(400).json({ error: 'Plano inválido.' });
    }

    const safeName = String(coupleName || 'Homenagem').trim().slice(0, 60) || 'Homenagem';
    const emailOk = typeof payerEmail === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail);

    const response = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`
      },
      body: JSON.stringify({
        transaction_amount: selectedPlan.price,
        description: `${selectedPlan.title} (${safeName})`,
        payment_method_id: 'pix',
        payer: {
          email: emailOk ? payerEmail : 'cliente@codigodoamor.com.br'
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: data.message || 'Erro ao gerar Pix no Mercado Pago'
      });
    }

    const claimToken = crypto.randomBytes(16).toString('hex');
    await set(
      `pix:${data.id}`,
      JSON.stringify({ token: claimToken, plan: planId, createdAt: Date.now() }),
      PIX_RECORD_TTL
    );

    return res.status(200).json({
      id: data.id,
      status: data.status,
      token: claimToken,
      qr_code: data.point_of_interaction?.transaction_data?.qr_code,
      qr_code_base64: data.point_of_interaction?.transaction_data?.qr_code_base64
    });
  } catch (error) {
    return res.status(500).json({ error: 'Falha interna ao processar pagamento.' });
  }
}

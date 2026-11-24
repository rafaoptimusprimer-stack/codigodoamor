export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    return res.status(500).json({ error: 'Variável MP_ACCESS_TOKEN não configurada na Vercel.' });
  }

  try {
    const { planId, coupleName, payerEmail } = req.body;

    const plans = {
      '15_dias': { price: 9.90, title: 'Código do Amor - Plano 15 Dias' },
      '1_ano': { price: 29.90, title: 'Código do Amor - Plano 1 Ano' }
    };

    const selectedPlan = plans[planId] || plans['15_dias'];

    const response = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
      },
      body: JSON.stringify({
        transaction_amount: selectedPlan.price,
        description: `${selectedPlan.title} (${coupleName || 'Homenagem'})`,
        payment_method_id: 'pix',
        payer: {
          email: payerEmail || 'cliente@codigodoamor.com.br'
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.message || 'Erro ao gerar Pix no Mercado Pago',
        details: data
      });
    }

    return res.status(200).json({
      id: data.id,
      status: data.status,
      qr_code: data.point_of_interaction.transaction_data.qr_code,
      qr_code_base64: data.point_of_interaction.transaction_data.qr_code_base64
    });
  } catch (error) {
    return res.status(500).json({ error: 'Falha interna ao processar pagamento.' });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'Variável MP_ACCESS_TOKEN não configurada na Vercel.' });
  }

  try {
    const { amount, description } = req.body || {};
    const transactionAmount = Number(amount) === 29.9 ? 29.9 : 9.9;

    const response = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `${Date.now()}-${Math.random().toString(36).slice(2)}`
      },
      body: JSON.stringify({
        transaction_amount: transactionAmount,
        description: description || 'Codigo do Amor',
        payment_method_id: 'pix',
        payer: {
          email: 'cliente@codigodoamor.com.br',
          first_name: 'Cliente',
          last_name: 'Codigo do Amor'
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.message || 'Erro retornado pelo Mercado Pago'
      });
    }

    return res.status(200).json({
      id: data.id,
      status: data.status,
      qr_code: data.point_of_interaction?.transaction_data?.qr_code,
      qr_code_base64: data.point_of_interaction?.transaction_data?.qr_code_base64
    });
  } catch (err) {
    return res.status(500).json({ error: 'Erro interno ao criar pagamento Pix.' });
  }
}

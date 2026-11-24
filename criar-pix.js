export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    return res.status(500).json({
      error: 'Variável MP_ACCESS_TOKEN não configurada na Vercel. Cole seu Access Token de Produção do Mercado Pago em Settings -> Environment Variables.'
    });
  }

  try {
    const { planId, planLabel, coupleName, payerEmail, pageData } = req.body;

    const validPrices = {
      '15_dias': 9.90,
      '1_ano': 29.90,
      'vitalicio': 49.90
    };
    const transactionAmount = validPrices[planId] || 49.90;
    const idempotencyKey = `cda-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Armazena os dados essenciais da homenagem nos metadados do pagamento
    // para que /api/verificar-pix reconstrua a página automaticamente quando aprovado
    const safeMetadata = {
      plan_id: planId,
      plan_label: planLabel,
      couple_name: coupleName,
      payer_email: payerEmail,
      theme: pageData?.theme || 'netflix',
      date: pageData?.date || '2023-10-30T20:00',
      message: (pageData?.message || '').slice(0, 500),
      music_url: pageData?.musicUrl || '',
      particles: pageData?.particles || '❤️',
      photo_0: (pageData?.photos?.[0] || '').startsWith('http') ? pageData.photos[0] : ''
    };

    const response = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({
        transaction_amount: transactionAmount,
        description: `Código do Amor (${planLabel}) - ${coupleName || 'Homenagem'}`,
        payment_method_id: 'pix',
        payer: {
          email: payerEmail
        },
        metadata: safeMetadata
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.message || 'Erro ao gerar Pix no Mercado Pago',
        details: data
      });
    }

    const pixInfo = data.point_of_interaction?.transaction_data || {};

    return res.status(200).json({
      payment_id: data.id,
      status: data.status,
      qr_code: pixInfo.qr_code,
      qr_code_base64: pixInfo.qr_code_base64
    });
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao conectar com API do Mercado Pago' });
  }
}

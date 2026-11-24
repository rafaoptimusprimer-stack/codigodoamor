export default async function handler(req, res) {
  const { id } = req.query;
  const accessToken = process.env.MP_ACCESS_TOKEN;

  if (!id) {
    return res.status(400).json({ error: 'ID do pagamento não informado' });
  }

  if (!accessToken) {
    return res.status(500).json({ error: 'MP_ACCESS_TOKEN não configurado na Vercel' });
  }

  try {
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Pagamento não encontrado' });
    }

    // Verifica validade conforme o plano contratado (15 dias, 1 ano ou vitalício)
    let isExpired = false;
    if (data.status === 'approved' && data.date_approved) {
      const approvedAt = new Date(data.date_approved).getTime();
      const now = Date.now();
      const planId = data.metadata?.plan_id || 'vitalicio';
      if (planId === '15_dias' && (now - approvedAt) > 15 * 24 * 3600 * 1000) {
        isExpired = true;
      } else if (planId === '1_ano' && (now - approvedAt) > 365 * 24 * 3600 * 1000) {
        isExpired = true;
      }
    }

    if (isExpired) {
      return res.status(200).json({ status: 'expired' });
    }

    const meta = data.metadata || {};
    const slug = (meta.couple_name || 'nosso-amor')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'nosso-amor';

    const publicUrl = `https://codigodoamoroficial.vercel.app/p/${slug}?pid=${data.id}`;
    const activationCode = `AMOR-${String(data.id).slice(-6)}`;

    // Envio automático de e-mail se RESEND_API_KEY estiver configurada na Vercel
    if (data.status === 'approved' && process.env.RESEND_API_KEY && meta.payer_email) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Codigo do Amor <onboarding@resend.dev>',
            to: [meta.payer_email],
            subject: `❤️ Sua Homenagem "${meta.couple_name}" foi Liberada!`,
            html: `
              <h2>Pagamento Pix Autorizado!</h2>
              <p>Sua página personalizada no <strong>Código do Amor</strong> já está ativa.</p>
              <p><strong>Código de Ativação:</strong> ${activationCode}</p>
              <p><strong>Link Exclusivo:</strong> <a href="${publicUrl}">${publicUrl}</a></p>
            `
          })
        });
      } catch (mailErr) {}
    }

    return res.status(200).json({
      payment_id: data.id,
      status: data.status, // 'pending' | 'approved'
      activation_code: activationCode,
      public_url: publicUrl,
      page_data: {
        theme: meta.theme || 'netflix',
        couple: meta.couple_name || 'Nossa História',
        date: meta.date || '2023-10-30T20:00',
        message: meta.message || '',
        musicUrl: meta.music_url || '',
        particles: meta.particles || '❤️',
        photos: meta.photo_0 ? [meta.photo_0] : undefined
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao consultar Mercado Pago' });
  }
}

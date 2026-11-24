export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    return res.status(500).json({ error: 'Variável MP_ACCESS_TOKEN não configurada.' });
  }

  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: 'ID do pagamento não informado.' });
  }

  try {
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

    return res.status(200).json({
      id: data.id,
      status: data.status
    });
  } catch (error) {
    return res.status(500).json({ error: 'Erro interno na consulta do Pix.' });
  }
}

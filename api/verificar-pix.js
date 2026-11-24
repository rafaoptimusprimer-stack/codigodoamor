export default async function handler(req, res) {
  const { id } = req.query || {};
  if (!id) {
    return res.status(400).json({ error: 'ID ausente' });
  }

  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'MP_ACCESS_TOKEN não configurado' });
  }

  try {
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await response.json();
    return res.status(200).json({ status: data.status });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao consultar pagamento' });
  }
}

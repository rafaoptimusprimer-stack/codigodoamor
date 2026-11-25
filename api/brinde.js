import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Variável ADMIN_SECRET não configurada na Vercel.' });
  }

  const { action, adminPassword, code } = req.body || {};

  // 1. GERAR CÓDIGO (APENAS ADMIN COM SENHA)
  if (action === 'generate') {
    if (!adminPassword || adminPassword !== secret) {
      return res.status(401).json({ error: 'Senha de administrador incorreta.' });
    }

    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // Válido por 24 horas
    const tsHex = expiresAt.toString(36).toUpperCase();
    const sig = crypto
      .createHmac('sha256', secret)
      .update(tsHex)
      .digest('hex')
      .slice(0, 8)
      .toUpperCase();

    return res.status(200).json({
      code: `AMOR-${tsHex}-${sig}`,
      expiresAt
    });
  }

  // 2. VALIDAR / RESGATAR CÓDIGO DO CLIENTE
  if (action === 'redeem') {
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Digite um código de brinde válido.' });
    }

    const parts = code.trim().toUpperCase().split('-');
    if (parts.length !== 3 || parts[0] !== 'AMOR') {
      return res.status(400).json({ error: 'Formato de código inválido.' });
    }

    const [, tsHex, providedSig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(tsHex)
      .digest('hex')
      .slice(0, 8)
      .toUpperCase();

    if (providedSig !== expectedSig) {
      return res.status(400).json({ error: 'Código de brinde inválido.' });
    }

    const expiresAt = parseInt(tsHex, 36);
    if (!expiresAt || Date.now() > expiresAt) {
      return res.status(400).json({ error: 'Este código expirou (prazo de 24h encerrado).' });
    }

    return res.status(200).json({ valid: true, planDays: 15 });
  }

  return res.status(400).json({ error: 'Ação inválida.' });
}

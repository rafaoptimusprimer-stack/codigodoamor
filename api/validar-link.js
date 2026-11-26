import crypto from 'crypto';

// Data de corte para links antigos sem assinatura (ajuste conforme desejar)
const LEGACY_CUTOFF_MS = Date.parse('2026-12-31T23:59:59-03:00');

function safeHexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function signGrant(signingKey, payloadStr) {
  return crypto.createHmac('sha256', signingKey).update(payloadStr).digest('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const signingKey = process.env.BRINDE_SIGNING_SECRET || process.env.ADMIN_SECRET;
  if (!signingKey) {
    return res.status(500).json({ valid: false, reason: 'missing_key' });
  }

  try {
    const { paymentId, plan, exp, sig, isLegacy } = req.body || {};

    if (!sig && isLegacy) {
      if (Date.now() <= LEGACY_CUTOFF_MS) {
        return res.status(200).json({ valid: true, legacy: true });
      }
      return res.status(200).json({ valid: false, reason: 'legacy_expired' });
    }

    if (!paymentId || !plan || !exp || !sig) {
      return res.status(200).json({ valid: false, reason: 'invalid_signature' });
    }

    const expectedSig = signGrant(signingKey, `${paymentId}:${plan}:${exp}`);
    if (!safeHexEqual(String(sig), expectedSig)) {
      return res.status(200).json({ valid: false, reason: 'invalid_signature' });
    }

    if (Date.now() > Number(exp)) {
      return res.status(200).json({ valid: false, reason: 'expired' });
    }

    return res.status(200).json({ valid: true, legacy: false });
  } catch (e) {
    return res.status(500).json({ valid: false, reason: 'server_error' });
  }
}

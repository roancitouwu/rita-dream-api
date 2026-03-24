import type { VercelRequest, VercelResponse } from '@vercel/node'

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.json({ status: 'ok', service: 'rita-dream-api', timestamp: Date.now() })
}

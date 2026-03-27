import type { VercelRequest, VercelResponse } from '@vercel/node'
import { cors } from '../lib/cors'

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return
  res.json({ status: 'ok', service: 'rita-dream-api', timestamp: Date.now() })
}

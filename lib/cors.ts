import type { VercelRequest, VercelResponse } from '@vercel/node'

const ALLOWED_ORIGINS = [
  'https://shesaved.me',
  'http://localhost:5173',  // dev
  'http://localhost:3000'
]

export function cors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin || ''
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true // handled
  }
  return false // continue
}

export function methodNotAllowed(req: VercelRequest, res: VercelResponse, allowed: string = 'POST'): boolean {
  if (req.method !== allowed) {
    res.status(405).json({ error: `Method ${req.method} not allowed` })
    return true
  }
  return false
}

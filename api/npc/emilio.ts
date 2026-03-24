import type { VercelRequest, VercelResponse } from '@vercel/node'

const KB_ID = process.env.DO_KB_ID || ''
const API_KEY = process.env.DO_API_KEY || ''
const MODEL_KEY = process.env.DO_MODEL_KEY || ''

async function retrieveEmilioStyle(tema: string): Promise<string[]> {
  if (!API_KEY || !KB_ID) return []
  try {
    const res = await fetch(`https://kbaas.do-ai.run/v1/${KB_ID}/retrieve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: tema, num_results: 6, alpha: 0.6 })
    })
    if (!res.ok) return []
    const data = await res.json() as { results?: Array<{ text_content: string }> }
    return (data.results || []).map(r => r.text_content)
  } catch { return [] }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS for shesaved.me
  res.setHeader('Access-Control-Allow-Origin', 'https://shesaved.me')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { situacion, contextoJuego = '', historialConversacion = '' } = req.body || {}
    if (!situacion) return res.status(400).json({ error: 'situacion required' })

    const ejemplos = await retrieveEmilioStyle(situacion)
    const ejemplosTexto = ejemplos.slice(0, 4).join('\n')

    const systemPrompt = `Eres Emilio, el novio de Rita. Respondes de forma natural.

PERSONALIDAD:
- Cariñoso y detallista con Rita
- Usas "jajaja", "JAJAJA", "xd" frecuentemente
- A veces dices cosas random/locas
- Si Rita ha estado dando vueltas, comenta con humor

EJEMPLOS:
${ejemplosTexto || 'Hablas cariñoso y espontáneo.'}

QUÉ HA ESTADO HACIENDO RITA:
${contextoJuego || 'Acaba de llegar.'}

HISTORIAL:
${historialConversacion || 'Inicio.'}

FORMATO: Responde SOLO JSON: {"text": "respuesta", "animation": "ANIM"}
ANIMACIONES: head_nod, idle_talking, confused, reject`

    if (!MODEL_KEY) {
      return res.json({ text: 'Hey mi amor jajaja', animation: 'idle_talking', duration: 3000 })
    }

    const llmRes = await fetch('https://inference.do-ai.run/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${MODEL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.3-70b-instruct',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Emilio responde a: ${situacion}` }
        ],
        temperature: 0.8,
        max_completion_tokens: 256
      })
    })

    if (!llmRes.ok) {
      return res.json({ text: 'Hmm... déjame pensar...', animation: 'confused' })
    }

    const llmData = await llmRes.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = llmData.choices?.[0]?.message?.content || ''

    try {
      const match = content.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        return res.json({ text: parsed.text || content, animation: parsed.animation || 'idle_talking', duration: 3000 })
      }
    } catch {}

    return res.json({ text: content, animation: 'idle_talking', duration: 3000 })
  } catch (error) {
    console.error('Error:', error)
    return res.status(500).json({ error: 'Internal error' })
  }
}

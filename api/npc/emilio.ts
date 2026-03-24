import type { VercelRequest, VercelResponse } from '@vercel/node'

// v2 - sugerencias + anti-slang
const KB_ID = process.env.DO_KB_ID || ''
const API_KEY = process.env.DO_API_KEY || ''
const MODEL_KEY = process.env.DO_MODEL_KEY || ''

async function retrieveEmilioStyle(tema: string, numResults: number = 15): Promise<string[]> {
  if (!API_KEY || !KB_ID) return []
  try {
    const res = await fetch(`https://kbaas.do-ai.run/v1/${KB_ID}/retrieve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: tema, num_results: numResults, alpha: 0.6 })
    })
    if (!res.ok) return []
    const data = await res.json() as { results?: Array<{ text_content: string }> }
    return (data.results || []).map(r => r.text_content)
  } catch { return [] }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', 'https://shesaved.me')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { situacion, contextoJuego = '', historialConversacion = '' } = req.body || {}
    if (!situacion) return res.status(400).json({ error: 'situacion required' })

    // Get MORE examples from KB for better generalization
    const ejemplos = await retrieveEmilioStyle(situacion, 15)
    const shuffled = ejemplos.sort(() => Math.random() - 0.5)
    const ejemplosTexto = shuffled.slice(0, 8).join('\n---\n')

    // Minimal prompt - let KB examples drive personality
    const systemPrompt = `Eres Emilio. Responde EXACTAMENTE como en estos mensajes reales tuyos:

${ejemplosTexto}

IMPORTANTE: NO uses slang genérico como "que onda", "wey", "neta". Usa TU estilo real de los ejemplos.

${historialConversacion ? `Conversación previa:\n${historialConversacion}` : ''}

JSON (sin markdown):
{"text": "respuesta en tu estilo real", "animation": "head_nod|idle_talking|confused|reject", "sugerencias": ["respuesta natural de Rita", "otra opción", "tercera"]}`

    if (!MODEL_KEY) {
      return res.json({ text: 'Hey mi amor jajaja', animation: 'idle_talking', duration: 3000, sugerencias: ['¿Y qué más?', 'Cuéntame más', 'Te quiero'] })
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
        temperature: 0.9,
        max_completion_tokens: 200,
        top_p: 0.95
      })
    })

    if (!llmRes.ok) {
      return res.json({ text: 'Hmm... déjame pensar...', animation: 'confused', sugerencias: ['¿Estás bien?', 'Cuéntame', 'Te quiero'] })
    }

    const llmData = await llmRes.json() as { choices?: Array<{ message?: { content?: string } }> }
    const content = llmData.choices?.[0]?.message?.content || ''

    try {
      const match = content.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        return res.json({ 
          text: parsed.text || content, 
          animation: parsed.animation || 'idle_talking', 
          duration: 3000,
          sugerencias: Array.isArray(parsed.sugerencias) ? parsed.sugerencias.slice(0, 3) : ['¿Y qué más?', 'Cuéntame más', 'Te quiero']
        })
      }
    } catch {}

    return res.json({ text: content, animation: 'idle_talking', duration: 3000, sugerencias: ['¿Y qué más?', 'Cuéntame más', 'Te quiero'] })
  } catch (error) {
    console.error('Error:', error)
    return res.status(500).json({ error: 'Internal error' })
  }
}

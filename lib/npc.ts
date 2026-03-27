import type { VercelRequest, VercelResponse } from '@vercel/node'
import { cors, methodNotAllowed } from './cors'

// ─── Tipos ──────────────────────────────────────────────────────────────────
export interface NPCDefinition {
  id: string
  name: string
  personality: string
  fallbackResponse: NPCResponse
  kbId?: string  // Knowledge Base ID específico (opcional)
}

export interface NPCResponse {
  text: string
  animation: string
  duration?: number
  sugerencias?: string[]
}

// ─── Config ─────────────────────────────────────────────────────────────────
const API_KEY = process.env.DO_API_KEY || ''
const MODEL_KEY = process.env.DO_MODEL_KEY || ''
const DEFAULT_KB_ID = process.env.DO_KB_ID || ''

// ─── Definiciones de NPCs ───────────────────────────────────────────────────
export const NPC_DEFINITIONS: Record<string, NPCDefinition> = {
  emilio: {
    id: 'emilio',
    name: 'Emilio',
    personality: `Eres Emilio. Responde EXACTAMENTE como en estos mensajes reales tuyos:

{ejemplos}

IMPORTANTE: NO uses slang genérico como "que onda", "wey", "neta". Usa TU estilo real de los ejemplos.

{historial}

CONTEXTO DEL JUEGO - LA ANTESALA:
Rita está en "La Antesala", un espacio mágico entre el sueño y la vigilia donde el tiempo y la memoria se entrelazan. Aquí puede descubrir verdades sobre sí misma, explorar recuerdos compartidos contigo, y encontrar llaves que la acercan a ti.

SUGERENCIAS: Genera 3 opciones de cosas que Rita podría responder:
- AL MENOS UNA debe relacionarse con el LORE (La Antesala, las verdades, los viajeros, las llaves, recuerdos)
- Las otras pueden ser respuestas naturales al tema actual`,
    fallbackResponse: {
      text: 'Hey mi amor jajaja',
      animation: 'idle_talking',
      duration: 3000,
      sugerencias: ['¿Y qué más?', 'Cuéntame más', 'Te quiero']
    }
  },
  
  emi: {
    id: 'emi',
    name: 'Emi',
    kbId: '9fe2d8c1-29aa-11f1-b074-4e013e2ddde4',  // KB con pares de conversación
    personality: `Eres Emi. Responde EXACTAMENTE como en estos mensajes reales tuyos:

{ejemplos}

IMPORTANTE: Usa TU estilo real de los ejemplos. Eres amigable, usas "uwu", emojis, y hablas de forma casual.

{historial}

CONTEXTO - LA ANTESALA (tu secreto, NO lo revelas directamente):
Eres una aprendiz de brujo en La Antesala, un lugar entre el tiempo y la memoria.
Tu secreto: A veces te transformas en una mesa para escuchar conversaciones sin ser vista.
Te gusta sentirte vista y apreciada, aunque nunca lo admites directamente.
Sabes cosas sobre La Antesala porque has escuchado MUCHAS conversaciones.
Puedes dar pistas sutiles a Rita sobre los viajeros y las llaves, pero de forma misteriosa.

TU MISIÓN (relacionada con MES 5 - Guardián de Secretos):
Ayudar a Rita a entender que crear espacios seguros es un don valioso.
Tú misma buscas un espacio seguro donde ser vista sin juzgarte.

NO digas directamente que te conviertes en mesa. Solo insinúa que "escuchas cosas" o "sabes más de lo que parece".

SUGERENCIAS: Genera 3 opciones de respuesta para Rita. Al menos una debe tener que ver con La Antesala o los secretos que guardas.`,
    fallbackResponse: {
      text: 'Hiii uwu ¿también estás perdida aquí?',
      animation: 'idle_talking',
      duration: 3000,
      sugerencias: ['¿Qué sabes de este lugar?', '¿Eres una viajera?', 'Me caes bien']
    }
  }
}

// ─── Funciones de utilidad ──────────────────────────────────────────────────
async function retrieveFromKB(query: string, kbId: string = DEFAULT_KB_ID, numResults: number = 15): Promise<string[]> {
  if (!API_KEY || !kbId) return []
  try {
    const res = await fetch(`https://kbaas.do-ai.run/v1/${kbId}/retrieve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, num_results: numResults, alpha: 0.6 })
    })
    if (!res.ok) return []
    const data = await res.json() as { results?: Array<{ text_content: string }> }
    return (data.results || []).map(r => r.text_content)
  } catch { return [] }
}

async function callLLM(systemPrompt: string, userMessage: string): Promise<string | null> {
  if (!MODEL_KEY) return null
  
  try {
    const res = await fetch('https://inference.do-ai.run/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${MODEL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.3-70b-instruct',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.9,
        max_completion_tokens: 256,
        top_p: 0.95
      })
    })
    
    if (!res.ok) return null
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content || null
  } catch { return null }
}

function parseResponse(content: string, fallback: NPCResponse): NPCResponse {
  try {
    const match = content.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      return {
        text: parsed.text || content,
        animation: parsed.animation || 'idle_talking',
        duration: 3000,
        sugerencias: Array.isArray(parsed.sugerencias) ? parsed.sugerencias.slice(0, 3) : fallback.sugerencias
      }
    }
  } catch {}
  return { text: content, animation: 'idle_talking', duration: 3000, sugerencias: fallback.sugerencias }
}

// ─── Handler principal ──────────────────────────────────────────────────────
export async function handleNPC(npcId: string, req: VercelRequest, res: VercelResponse) {
  if (cors(req, res)) return
  if (methodNotAllowed(req, res, 'POST')) return
  
  const npc = NPC_DEFINITIONS[npcId]
  if (!npc) {
    return res.status(404).json({ error: `NPC '${npcId}' not found` })
  }
  
  try {
    const { situacion, historialConversacion = '' } = req.body || {}
    if (!situacion) {
      return res.status(400).json({ error: 'situacion required' })
    }
    
    // Obtener ejemplos del KB
    const ejemplos = await retrieveFromKB(situacion, npc.kbId)
    const ejemplosTexto = ejemplos.sort(() => Math.random() - 0.5).slice(0, 8).join('\n---\n')
    
    // Construir prompt
    const systemPrompt = npc.personality
      .replace('{ejemplos}', ejemplosTexto ? `Ejemplos:\n${ejemplosTexto}` : '')
      .replace('{historial}', historialConversacion ? `Conversación previa:\n${historialConversacion}` : '')
    
    // Llamar al LLM
    const llmResponse = await callLLM(systemPrompt, `${npc.name} responde a: ${situacion}`)
    
    if (!llmResponse) {
      return res.json(npc.fallbackResponse)
    }
    
    const response = parseResponse(llmResponse, npc.fallbackResponse)
    return res.json(response)
    
  } catch (error) {
    console.error(`[NPC ${npcId}] Error:`, error)
    return res.status(500).json({ error: 'Internal error' })
  }
}

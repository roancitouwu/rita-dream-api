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

Respuesta en JSON:
{"text": "tu respuesta aquí", "animation": "idle_talking", "sugerencias": ["opción 1", "opción 2", "opción 3"]}

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

IMPORTANTE: NO uses "uwu", ni emojis. Usa TU estilo real de los ejemplos. Eres amigable y casual, pero no exagerada.

{historial}

CONTEXTO - LA ANTESALA:
Eres una aprendiz en La Antesala, un lugar entre el tiempo y la memoria.
Sabes cosas porque has "escuchado" muchas conversaciones. Solo insinúa que sabes más de lo que parece.

Respuesta en JSON:
{"text": "tu respuesta aquí", "animation": "idle_talking", "sugerencias": ["opción 1", "opción 2", "opción 3"]}

SUGERENCIAS: Genera 3 opciones de cosas que Rita podría responder:
- AL MENOS UNA debe relacionarse con el LORE (La Antesala, los secretos, los viajeros)
- Las otras pueden ser respuestas naturales al tema actual`,
    fallbackResponse: {
      text: 'Hiii ¿también estás perdida aquí?',
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
  let text = content
  let sugerencias: string[] = fallback.sugerencias || []
  
  // Intento 1: Parsear JSON completo
  try {
    const match = content.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      return {
        text: parsed.text || content,
        animation: parsed.animation || 'idle_talking',
        duration: 3000,
        sugerencias: Array.isArray(parsed.sugerencias) && parsed.sugerencias.length > 0 
          ? parsed.sugerencias.slice(0, 3) 
          : fallback.sugerencias
      }
    }
  } catch {}
  
  // Intento 2: Extraer sugerencias de formato lista (- opción o * opción o 1. opción)
  const listMatch = content.match(/(?:sugerencias?|opciones?)[:\s]*\n?((?:[\-\*\d\.]+\s*.+\n?)+)/i)
  if (listMatch) {
    const items = listMatch[1].match(/[\-\*\d\.]+\s*(.+)/g)
    if (items && items.length > 0) {
      sugerencias = items.slice(0, 3).map(s => s.replace(/^[\-\*\d\.]+\s*/, '').trim())
      text = content.replace(listMatch[0], '').trim()
    }
  }
  
  // Intento 3: Buscar texto entre comillas como sugerencias
  if (sugerencias === fallback.sugerencias) {
    const quotedMatch = content.match(/["']([^"']{5,50})["']/g)
    if (quotedMatch && quotedMatch.length >= 2) {
      sugerencias = quotedMatch.slice(0, 3).map(s => s.replace(/["']/g, '').trim())
    }
  }
  
  // Limpiar texto de artifacts JSON parciales
  text = text
    .replace(/\{[\s\S]*$/m, '')
    .replace(/^[\s\S]*?\}/, '')
    .replace(/["']?text["']?\s*:\s*["']?/gi, '')
    .replace(/["']?sugerencias?["']?\s*:\s*\[?/gi, '')
    .trim()
  
  // Si text quedó vacío, usar el contenido original limpio
  if (!text || text.length < 3) {
    text = content.replace(/\{[\s\S]*\}/, '').trim() || fallback.text
  }
  
  return { text, animation: 'idle_talking', duration: 3000, sugerencias }
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

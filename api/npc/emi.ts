import type { VercelRequest, VercelResponse } from '@vercel/node'
import { handleNPC } from '../../lib/npc'

export default (req: VercelRequest, res: VercelResponse) => handleNPC('emi', req, res)

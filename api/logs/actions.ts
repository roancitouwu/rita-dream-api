import type { VercelRequest, VercelResponse } from '@vercel/node'

// MongoDB connection (optional - add MONGODB_URI env var to enable)
let mongoose: typeof import('mongoose') | null = null
let SessionModel: any = null

async function connectDB() {
  if (!process.env.MONGODB_URI) return false
  if (mongoose && mongoose.connection.readyState === 1) return true
  
  try {
    const mongooseModule = await import('mongoose')
    mongoose = mongooseModule.default || mongooseModule
    await mongoose.connect(process.env.MONGODB_URI)
    
    const schema = new mongoose.Schema({
      sessionId: { type: String, required: true, index: true },
      actions: Array,
      summary: Object,
      createdAt: { type: Date, default: Date.now }
    })
    
    SessionModel = mongoose.models.Session || mongoose.model('Session', schema)
    return true
  } catch (e) {
    console.error('MongoDB connection failed:', e)
    return false
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', 'https://shesaved.me')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const { sessionId, actions, summary } = req.body || {}
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' })

    // Log to console (always)
    console.log(`[Session ${sessionId}] ${actions?.length || 0} actions`, summary?.mood || '')

    // Try to save to MongoDB if configured
    const dbConnected = await connectDB()
    if (dbConnected && SessionModel) {
      await SessionModel.findOneAndUpdate(
        { sessionId },
        { $set: { summary }, $push: { actions: { $each: actions || [] } } },
        { upsert: true }
      )
      return res.json({ success: true, stored: true })
    }

    return res.json({ success: true, stored: false, message: 'No DB configured' })
  } catch (error) {
    console.error('Logs error:', error)
    return res.status(500).json({ error: 'Internal error' })
  }
}

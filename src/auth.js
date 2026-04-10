

require('dotenv').config()

const validKeys = (process.env.API_KEYS || '').split(',').map(k => k.trim())

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key']

  if (!key || !validKeys.includes(key)) {
    return res.status(401).json({ error: 'Invalid or missing API key' })
  }

  req.apiKey = key
  next()
}

module.exports = { requireApiKey }
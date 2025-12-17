// Minimal Node HTTP server with file-based storage and no external deps
// Serves code.html and provides /api for auth and vault CRUD
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'data')
const VAULT_DIR = path.join(DATA_DIR, 'vault')
const USERS_FILE = path.join(DATA_DIR, 'users.json')

ensureDirs()

const sessions = new Map()
const SERVER_PORT = process.env.PORT ? Number(process.env.PORT) : 8080
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

const server = http.createServer(async (req, res) => {
  // static serve public/index.html and root
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const file = path.join(ROOT, 'public', 'index.html')
    try {
      const html = fs.readFileSync(file)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('index.html not found')
    }
    return
  }

  // basic CORS for API
  if (req.url && req.url.startsWith('/api')) {
    if (req.method === 'OPTIONS') {
      return sendCors(res, 200)
    }
  }

  // routing
  const u = new URL(req.url || '/', `http://localhost:${SERVER_PORT}`)
  try {
    if (req.method === 'POST' && u.pathname === '/api/register') {
      const body = await readJson(req)
      const { username, password } = body || {}
      if (!isValidUser(username) || !isValidPassword(password)) {
        return sendJson(res, 400, { error: 'Invalid username or password' })
      }
      const users = loadUsers()
      if (users[username]) return sendJson(res, 409, { error: 'User exists' })
      const salt = crypto.randomBytes(16).toString('hex')
      const iterations = 120000
      const hash = hashPassword(password, salt, iterations)
      users[username] = { salt, hash, iterations, createdAt: new Date().toISOString() }
      fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2))
      ensureUserVault(username)
      return sendJson(res, 201, { ok: true })
    }

    if (req.method === 'POST' && u.pathname === '/api/login') {
      const body = await readJson(req)
      const { username, password } = body || {}
      const users = loadUsers()
      const urec = users[username]
      if (!urec) return sendJson(res, 401, { error: 'Invalid credentials' })
      const valid = verifyPassword(password, urec.salt, urec.iterations, urec.hash)
      if (!valid) return sendJson(res, 401, { error: 'Invalid credentials' })
      const token = crypto.randomBytes(32).toString('hex')
      sessions.set(token, { username, expires: Date.now() + TOKEN_TTL_MS })
      return sendJson(res, 200, { token, username })
    }

    if (req.method === 'GET' && u.pathname === '/api/me') {
      const auth = getAuth(req)
      if (!auth) return sendJson(res, 401, { error: 'Unauthorized' })
      return sendJson(res, 200, { username: auth.username })
    }

    if (req.method === 'GET' && u.pathname === '/api/entries') {
      const auth = getAuth(req)
      if (!auth) return sendJson(res, 401, { error: 'Unauthorized' })
      const entries = loadEntries(auth.username)
      return sendJson(res, 200, { entries })
    }

    if (req.method === 'GET' && u.pathname === '/api/categories') {
      const auth = getAuth(req)
      if (!auth) return sendJson(res, 401, { error: 'Unauthorized' })
      const entries = loadEntries(auth.username)
      // 从现有条目中提取所有唯一分类
      const categories = [...new Set(entries.map(e => e.category).filter(Boolean))]
      return sendJson(res, 200, { categories })
    }

    if (req.method === 'POST' && u.pathname === '/api/categories') {
      const auth = getAuth(req)
      if (!auth) return sendJson(res, 401, { error: 'Unauthorized' })
      const body = await readJson(req)
      const { category } = body || {}
      if (!category || typeof category !== 'string' || category.trim() === '') {
        return sendJson(res, 400, { error: 'Invalid category' })
      }
      const entries = loadEntries(auth.username)
      // 确保分类唯一
      const categories = [...new Set(entries.map(e => e.category).filter(Boolean))]
      if (!categories.includes(category)) {
        // 为了保持简单，我们不单独存储分类，而是通过在条目中使用来管理
        // 这里只需要返回成功，因为分类会在添加/编辑条目时自动创建
      }
      return sendJson(res, 201, { category })
    }

    if (req.method === 'DELETE' && u.pathname.startsWith('/api/categories/')) {
      const auth = getAuth(req)
      if (!auth) return sendJson(res, 401, { error: 'Unauthorized' })
      const categoryToDelete = decodeURIComponent(u.pathname.split('/').pop())
      const entries = loadEntries(auth.username)
      // 将所有使用该分类的条目设置为未分类
      const updatedEntries = entries.map(e => {
        if (e.category === categoryToDelete) {
          return { ...e, category: undefined, updatedAt: new Date().toISOString() }
        }
        return e
      })
      saveEntries(auth.username, updatedEntries)
      return sendJson(res, 200, { ok: true })
    }

    if (req.method === 'POST' && u.pathname === '/api/entries') {
      const auth = getAuth(req)
      if (!auth) return sendJson(res, 401, { error: 'Unauthorized' })
      const body = await readJson(req)
      const { url: siteUrl, username, owner, tags = [], note, passwordEncrypted, faviconUrl } = body || {}
      if (!siteUrl || !username || !passwordEncrypted) {
        return sendJson(res, 400, { error: 'Missing fields' })
      }
      const entries = loadEntries(auth.username)
      const now = new Date().toISOString()
      const entry = {
        id: crypto.randomUUID(),
        url: siteUrl,
        username,
        owner: owner || auth.username,
        tags: Array.isArray(tags) ? tags : [],
        note,
        passwordEncrypted,
        faviconUrl,
        createdAt: now,
        updatedAt: now,
      }
      entries.unshift(entry)
      saveEntries(auth.username, entries)
      return sendJson(res, 201, { entry })
    }

    if (req.method === 'PUT' && u.pathname.startsWith('/api/entries/')) {
      const auth = getAuth(req)
      if (!auth) return sendJson(res, 401, { error: 'Unauthorized' })
      const id = u.pathname.split('/').pop()
      const updates = await readJson(req)
      const entries = loadEntries(auth.username)
      let updated = null
      const next = entries.map((e) => {
        if (e.id === id) {
          updated = { ...e, ...updates, updatedAt: new Date().toISOString() }
          return updated
        }
        return e
      })
      saveEntries(auth.username, next)
      return sendJson(res, updated ? 200 : 404, updated ? { entry: updated } : { error: 'Not found' })
    }

    if (req.method === 'DELETE' && u.pathname.startsWith('/api/entries/')) {
      const auth = getAuth(req)
      if (!auth) return sendJson(res, 401, { error: 'Unauthorized' })
      const id = u.pathname.split('/').pop()
      const entries = loadEntries(auth.username)
      const next = entries.filter((e) => e.id !== id)
      const deleted = next.length !== entries.length
      saveEntries(auth.username, next)
      return sendJson(res, deleted ? 200 : 404, deleted ? { ok: true } : { error: 'Not found' })
    }

    if (req.method === 'GET' && u.pathname === '/api/export') {
      const auth = getAuth(req)
      if (!auth) return sendJson(res, 401, { error: 'Unauthorized' })
      const entries = loadEntries(auth.username)
      return sendJson(res, 200, {
        version: 1,
        username: auth.username,
        exportedAt: new Date().toISOString(),
        entries,
      })
    }

    sendJson(res, 404, { error: 'Not found' })
  } catch (e) {
    console.error(e)
    sendJson(res, 500, { error: 'Server error' })
  }
})

server.listen(SERVER_PORT, () => {
  console.log(`SecureVault server running at http://localhost:${SERVER_PORT}`)
})

function sendCors(res, status = 200) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  })
  res.end()
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  })
  res.end(JSON.stringify(obj))
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : null)
      } catch {
        resolve(null)
      }
    })
  })
}

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(VAULT_DIR, { recursive: true })
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({}, null, 2))
  }
}

function ensureUserVault(username) {
  const file = vaultFile(username)
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify([], null, 2))
  }
}

function vaultFile(username) {
  return path.join(VAULT_DIR, `${username}.json`)
}

function loadUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf-8')
    return JSON.parse(raw || '{}')
  } catch {
    return {}
  }
}

function loadEntries(username) {
  ensureUserVault(username)
  try {
    const raw = fs.readFileSync(vaultFile(username), 'utf-8')
    return JSON.parse(raw || '[]')
  } catch {
    return []
  }
}

function saveEntries(username, entries) {
  ensureUserVault(username)
  fs.writeFileSync(vaultFile(username), JSON.stringify(entries, null, 2))
}

function hashPassword(password, salt, iterations) {
  const key = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256')
  return key.toString('hex')
}

function verifyPassword(password, salt, iterations, expectedHex) {
  const hex = hashPassword(password, salt, iterations)
  return crypto.timingSafeEqual(Buffer.from(hex, 'hex'), Buffer.from(expectedHex, 'hex'))
}

function getAuth(req) {
  const auth = req.headers['authorization'] || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return null
  const sess = sessions.get(token)
  if (!sess) return null
  if (sess.expires < Date.now()) {
    sessions.delete(token)
    return null
  }
  return { username: sess.username }
}

function isValidUser(u) {
  return typeof u === 'string' && /^[a-zA-Z0-9._-]{3,32}$/.test(u)
}

function isValidPassword(p) {
  return typeof p === 'string' && p.length >= 6
}


// Vercel Serverless函数处理所有API请求
import http from 'node:http';
import crypto from 'node:crypto';
import { Pool } from 'pg';

// 创建PostgreSQL连接池
// 增强数据库连接配置和错误处理
console.log('PostgreSQL连接配置:', {
  hasConnectionString: !!process.env.VERCEL_POSTGRES_URL,
  hasPostgresUrl: !!process.env.POSTGRES_URL,
  hasDatabaseUrl: !!process.env.DATABASE_URL
});

// 支持多种PostgreSQL环境变量
const connectionString = process.env.VERCEL_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL;

let pool = null;

if (!connectionString) {
  console.error('ERROR: 未找到数据库连接字符串！请确保已配置以下环境变量之一：\n' +
    '- VERCEL_POSTGRES_URL (DATABASE_URL)\n' +
    '- POSTGRES_URL (Neon等其他服务)\n' +
    '- DATABASE_URL (通用PostgreSQL连接URL)');
  console.error('API将无法正常工作，因为无法连接到数据库！');
} else {
  pool = new Pool({
    connectionString: connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });

  // 监听连接错误
  pool.on('error', (err) => {
    console.error('PostgreSQL连接错误:', {
      error: err.message,
      code: err.code,
      stack: err.stack
    });
  });
}

// 内存会话存储（可以考虑迁移到Redis）
const sessions = new Map();
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// 初始化数据库表
async function initDatabase() {
  if (!connectionString) {
    console.error('跳过数据库初始化：未配置数据库连接字符串');
    return;
  }
  
  try {
    // 测试数据库连接
    console.log('测试数据库连接...');
    await pool.query('SELECT 1');
    console.log('数据库连接成功！');
    
    // 创建用户表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        username VARCHAR(32) PRIMARY KEY,
        salt VARCHAR(32) NOT NULL,
        hash VARCHAR(64) NOT NULL,
        iterations INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // 创建密码条目表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner VARCHAR(32) NOT NULL REFERENCES users(username),
        url TEXT NOT NULL,
        username TEXT NOT NULL,
        password_encrypted TEXT NOT NULL,
        favicon_url TEXT,
        note TEXT,
        tags TEXT[] DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('数据库初始化失败:', {
      message: error.message,
      code: error.code,
      stack: error.stack,
      detail: error.detail,
      hint: error.hint
    });
    
    // 提供特定错误类型的解决方案
    if (error.code === 'ECONNREFUSED' || error.message.includes('connection')) {
      console.error('解决方案：1. 确保Vercel Postgres已正确集成2. 检查环境变量是否正确设置3. 验证数据库服务是否正在运行4. 检查网络连接和防火墙设置');
    } else if (error.code === '42P01') {
      console.error('解决方案:- 表不存在错误，检查SQL语句是否正确');
    } else if (error.code === '42601') {
      console.error('解决方案：- SQL语法错误，检查SQL语句格式');
    }
  }
}

// 初始化数据库
initDatabase();

// 辅助函数
function hashPassword(password, salt, iterations) {
  const key = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  return key.toString('hex');
}

function verifyPassword(password, salt, iterations, expectedHex) {
  const hex = hashPassword(password, salt, iterations);
  return crypto.timingSafeEqual(Buffer.from(hex, 'hex'), Buffer.from(expectedHex, 'hex'));
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(obj));
}

function getAuth(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const sess = sessions.get(token);
  if (!sess) return null;
  if (sess.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { username: sess.username };
}

function isValidUser(u) {
  return typeof u === 'string' && /^[a-zA-Z0-9._-]{3,32}$/.test(u);
}

function isValidPassword(p) {
  return typeof p === 'string' && p.length >= 6;
}

// 主要请求处理函数
export default async (req, res) => {
  // 处理OPTIONS请求
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, {});
  }

  // 解析请求路径
  const url = new URL(req.url, `http://localhost:3000`);
  const path = url.pathname;

  try {
    // 读取请求体
    let body = null;
    if (req.method !== 'GET' && req.method !== 'DELETE') {
      body = await new Promise((resolve) => {
        let data = '';
        req.on('data', (chunk) => (data += chunk));
        req.on('end', () => {
          try {
            resolve(data ? JSON.parse(data) : null);
          } catch {
            resolve(null);
          }
        });
      });
    }

    // 路由处理
    // 注册
    if (req.method === 'POST' && path === '/api/register') {
      const { username, password } = body || {};
      if (!isValidUser(username) || !isValidPassword(password)) {
        return sendJson(res, 400, { error: 'Invalid username or password' });
      }
      
      try {
        if (!pool) {
          console.error('Registration failed: Database connection pool not initialized');
          return sendJson(res, 500, { error: 'Database connection not available' });
        }
        // 检查用户是否已存在
        const userExists = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
        if (userExists.rows.length > 0) {
          return sendJson(res, 409, { error: 'User exists' });
        }
        
        // 创建新用户
        const salt = crypto.randomBytes(16).toString('hex');
        const iterations = 120000;
        const hash = hashPassword(password, salt, iterations);
        
        await pool.query(
          'INSERT INTO users (username, salt, hash, iterations) VALUES ($1, $2, $3, $4)',
          [username, salt, hash, iterations]
        );
        
        return sendJson(res, 201, { ok: true });
      } catch (error) {
        console.error('Registration error:', {
          error: error.message,
          code: error.code,
          stack: error.stack
        });
        return sendJson(res, 500, { error: 'Database error', details: process.env.NODE_ENV === 'development' ? error.message : 'Please check server logs' });
      }
    }

    // 登录
    if (req.method === 'POST' && path === '/api/login') {
      const { username, password } = body || {};
      
      try {
        if (!pool) {
          console.error('Login failed: Database connection pool not initialized');
          return sendJson(res, 500, { error: 'Database connection not available' });
        }
        // 获取用户信息
        const result = await pool.query(
          'SELECT salt, hash, iterations FROM users WHERE username = $1',
          [username]
        );
        
        if (result.rows.length === 0) {
          return sendJson(res, 401, { error: 'Invalid credentials' });
        }
        
        const urec = result.rows[0];
        const valid = verifyPassword(password, urec.salt, urec.iterations, urec.hash);
        
        if (!valid) {
          return sendJson(res, 401, { error: 'Invalid credentials' });
        }
        
        // 创建会话令牌
        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(token, { username, expires: Date.now() + TOKEN_TTL_MS });
        
        return sendJson(res, 200, { token, username });
      } catch (error) {
        console.error('Login error:', error);
        return sendJson(res, 500, { error: 'Database error' });
      }
    }

    // 获取当前用户
    if (req.method === 'GET' && path === '/api/me') {
      const auth = getAuth(req);
      if (!auth) return sendJson(res, 401, { error: 'Unauthorized' });
      return sendJson(res, 200, { username: auth.username });
    }

    // 获取所有条目
    if (req.method === 'GET' && path === '/api/entries') {
      const auth = getAuth(req);
      if (!auth) return sendJson(res, 401, { error: 'Unauthorized' });
      
      try {
        if (!pool) {
          console.error('Get entries failed: Database connection pool not initialized');
          return sendJson(res, 500, { error: 'Database connection not available' });
        }
        const result = await pool.query(
          `SELECT id, owner, url, username, password_encrypted, favicon_url, note, tags, created_at, updated_at 
           FROM password_entries 
           WHERE owner = $1 
           ORDER BY created_at DESC`,
          [auth.username]
        );
        
        // 转换为前端期望的格式
        const entries = result.rows.map(row => ({
          id: row.id,
          url: row.url,
          username: row.username,
          owner: row.owner,
          passwordEncrypted: row.password_encrypted,
          faviconUrl: row.favicon_url,
          note: row.note,
          tags: row.tags,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString()
        }));
        
        return sendJson(res, 200, { entries });
      } catch (error) {
        console.error('Get entries error:', error);
        return sendJson(res, 500, { error: 'Database error' });
      }
    }

    // 添加条目
    if (req.method === 'POST' && path === '/api/entries') {
      const auth = getAuth(req);
      if (!auth) return sendJson(res, 401, { error: 'Unauthorized' });
      const { url: siteUrl, username, owner, tags = [], note, passwordEncrypted, faviconUrl } = body || {};
      if (!siteUrl || !username || !passwordEncrypted) {
        return sendJson(res, 400, { error: 'Missing fields' });
      }
      
      try {
        if (!pool) {
          console.error('Add entry failed: Database connection pool not initialized');
          return sendJson(res, 500, { error: 'Database connection not available' });
        }
        const result = await pool.query(
          `INSERT INTO password_entries (owner, url, username, password_encrypted, favicon_url, note, tags)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, created_at, updated_at`,
          [owner || auth.username, siteUrl, username, passwordEncrypted, faviconUrl, note, tags]
        );
        
        const inserted = result.rows[0];
        const entry = {
          id: inserted.id,
          url: siteUrl,
          username,
          owner: owner || auth.username,
          passwordEncrypted,
          faviconUrl,
          note,
          tags,
          createdAt: inserted.created_at.toISOString(),
          updatedAt: inserted.updated_at.toISOString()
        };
        
        return sendJson(res, 201, { entry });
      } catch (error) {
        console.error('Add entry error:', error);
        return sendJson(res, 500, { error: 'Database error' });
      }
    }

    // 更新条目
    if (req.method === 'PUT' && path.startsWith('/api/entries/')) {
      const auth = getAuth(req);
      if (!auth) return sendJson(res, 401, { error: 'Unauthorized' });
      const id = path.split('/').pop();
      const updates = body;
      
      try {
        if (!pool) {
          console.error('Update entry failed: Database connection pool not initialized');
          return sendJson(res, 500, { error: 'Database connection not available' });
        }
        // 准备更新字段
        const updateFields = [];
        const updateValues = [];
        let paramIndex = 1;
        
        if (updates.url) {
          updateFields.push(`url = $${paramIndex++}`);
          updateValues.push(updates.url);
        }
        if (updates.username) {
          updateFields.push(`username = $${paramIndex++}`);
          updateValues.push(updates.username);
        }
        if (updates.passwordEncrypted) {
          updateFields.push(`password_encrypted = $${paramIndex++}`);
          updateValues.push(updates.passwordEncrypted);
        }
        if (updates.faviconUrl) {
          updateFields.push(`favicon_url = $${paramIndex++}`);
          updateValues.push(updates.faviconUrl);
        }
        if (updates.note) {
          updateFields.push(`note = $${paramIndex++}`);
          updateValues.push(updates.note);
        }
        if (updates.tags) {
          updateFields.push(`tags = $${paramIndex++}`);
          updateValues.push(updates.tags);
        }
        
        // 总是更新updated_at字段
        updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
        
        if (updateFields.length === 0) {
          return sendJson(res, 400, { error: 'No fields to update' });
        }
        
        // 添加id和owner参数
        updateValues.push(id);
        updateValues.push(auth.username);
        
        const result = await pool.query(
          `UPDATE password_entries 
           SET ${updateFields.join(', ')}
           WHERE id = $${paramIndex++} AND owner = $${paramIndex}
           RETURNING id, owner, url, username, password_encrypted, favicon_url, note, tags, created_at, updated_at`,
          updateValues
        );
        
        if (result.rows.length === 0) {
          return sendJson(res, 404, { error: 'Not found' });
        }
        
        // 转换为前端期望的格式
        const row = result.rows[0];
        const updated = {
          id: row.id,
          url: row.url,
          username: row.username,
          owner: row.owner,
          passwordEncrypted: row.password_encrypted,
          faviconUrl: row.favicon_url,
          note: row.note,
          tags: row.tags,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString()
        };
        
        return sendJson(res, 200, { entry: updated });
      } catch (error) {
        console.error('Update entry error:', error);
        return sendJson(res, 500, { error: 'Database error' });
      }
    }

    // 删除条目
    if (req.method === 'DELETE' && path.startsWith('/api/entries/')) {
      const auth = getAuth(req);
      if (!auth) return sendJson(res, 401, { error: 'Unauthorized' });
      const id = path.split('/').pop();
      
      try {
        if (!pool) {
          console.error('Delete entry failed: Database connection pool not initialized');
          return sendJson(res, 500, { error: 'Database connection not available' });
        }
        const result = await pool.query(
          'DELETE FROM password_entries WHERE id = $1 AND owner = $2',
          [id, auth.username]
        );
        
        const deleted = result.rowCount > 0;
        return sendJson(res, deleted ? 200 : 404, deleted ? { ok: true } : { error: 'Not found' });
      } catch (error) {
        console.error('Delete entry error:', error);
        return sendJson(res, 500, { error: 'Database error' });
      }
    }

    // 获取分类
    if (req.method === 'GET' && path === '/api/categories') {
      const auth = getAuth(req);
      if (!auth) return sendJson(res, 401, { error: 'Unauthorized' });
      
      try {
        if (!pool) {
          console.error('Get categories failed: Database connection pool not initialized');
          return sendJson(res, 500, { error: 'Database connection not available' });
        }
        // 从所有条目的tags数组中提取唯一分类
        const result = await pool.query(
          `SELECT DISTINCT UNNEST(tags) as category 
           FROM password_entries 
           WHERE owner = $1 AND tags IS NOT NULL AND tags != '{}'`,
          [auth.username]
        );
        
        const categories = result.rows.map(row => row.category).filter(Boolean);
        return sendJson(res, 200, { categories });
      } catch (error) {
        console.error('Get categories error:', error);
        return sendJson(res, 500, { error: 'Database error' });
      }
    }

    // 添加分类
    if (req.method === 'POST' && path === '/api/categories') {
      const auth = getAuth(req);
      if (!auth) return sendJson(res, 401, { error: 'Unauthorized' });
      const { category } = body || {};
      if (!category || typeof category !== 'string' || category.trim() === '') {
        return sendJson(res, 400, { error: 'Invalid category' });
      }
      // 分类通过条目自动管理，这里只需要返回成功
      return sendJson(res, 201, { category });
    }

    // 删除分类
    if (req.method === 'DELETE' && path.startsWith('/api/categories/')) {
      const auth = getAuth(req);
      if (!auth) return sendJson(res, 401, { error: 'Unauthorized' });
      const categoryToDelete = decodeURIComponent(path.split('/').pop());
      
      try {
        if (!pool) {
          console.error('Delete category failed: Database connection pool not initialized');
          return sendJson(res, 500, { error: 'Database connection not available' });
        }
        // 从所有条目的tags数组中移除该分类
        await pool.query(
          `UPDATE password_entries 
           SET tags = array_remove(tags, $1), updated_at = CURRENT_TIMESTAMP
           WHERE owner = $2`,
          [categoryToDelete, auth.username]
        );
        
        return sendJson(res, 200, { ok: true });
      } catch (error) {
        console.error('Delete category error:', error);
        return sendJson(res, 500, { error: 'Database error' });
      }
    }

    // 导出数据
    if (req.method === 'GET' && path === '/api/export') {
      const auth = getAuth(req);
      if (!auth) return sendJson(res, 401, { error: 'Unauthorized' });
      
      try {
        const result = await pool.query(
          `SELECT id, owner, url, username, password_encrypted, favicon_url, note, tags, created_at, updated_at 
           FROM password_entries 
           WHERE owner = $1`,
          [auth.username]
        );
        
        // 转换为前端期望的格式
        const entries = result.rows.map(row => ({
          id: row.id,
          url: row.url,
          username: row.username,
          owner: row.owner,
          passwordEncrypted: row.password_encrypted,
          faviconUrl: row.favicon_url,
          note: row.note,
          tags: row.tags,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString()
        }));
        
        return sendJson(res, 200, {
          version: 1,
          username: auth.username,
          exportedAt: new Date().toISOString(),
          entries,
        });
      } catch (error) {
        console.error('Export data error:', error);
        return sendJson(res, 500, { error: 'Database error' });
      }
    }

    // 未找到路由
    sendJson(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { error: 'Server error' });
  }
};

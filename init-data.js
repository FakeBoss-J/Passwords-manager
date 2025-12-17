#!/usr/bin/env node

// 数据库示例数据初始化脚本
// 使用方法：
// 1. 设置环境变量：set POSTGRES_URL=your-connection-string
// 2. 运行脚本：node init-data.js

import { Pool } from 'pg';
import crypto from 'node:crypto';

console.log('=== 密码管理器数据库初始化工具 ===\n');

// 检测环境变量
const connectionString = process.env.VERCEL_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ 错误：未找到数据库连接字符串！');
  console.error('请设置以下环境变量之一：');
  console.error('- VERCEL_POSTGRES_URL (Vercel Postgres)');
  console.error('- POSTGRES_URL (Neon等其他服务)');
  console.error('- DATABASE_URL (通用PostgreSQL连接URL)');
  console.error('\n设置方法示例：');
  console.error('Windows: set POSTGRES_URL=your-connection-string');
  console.error('Linux/Mac: export POSTGRES_URL=your-connection-string');
  process.exit(1);
}

console.log('✅ 已检测到环境变量');
console.log('连接字符串前缀：', connectionString.substring(0, 20) + '...');

// 创建连接池
const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

// 哈希密码函数
function hashPassword(password, salt, iterations) {
  const key = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  return key.toString('hex');
}

// 初始化示例数据
async function initSampleData() {
  try {
    console.log('\n🔍 正在连接到数据库...');
    const client = await pool.connect();
    
    try {
      // 开始事务
      await client.query('BEGIN');
      
      // 1. 检查并创建用户表
      console.log('📋 检查用户表结构...');
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          username VARCHAR(32) PRIMARY KEY,
          salt VARCHAR(32) NOT NULL,
          hash VARCHAR(64) NOT NULL,
          iterations INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      // 2. 检查并创建密码条目表
      console.log('📋 检查密码条目表结构...');
      await client.query(`
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
      
      // 3. 创建示例用户
      console.log('\n👤 创建示例用户...');
      
      // 用户1: testuser
      const user1Salt = crypto.randomBytes(16).toString('hex');
      const user1Hash = hashPassword('password123', user1Salt, 120000);
      
      try {
        await client.query(
          'INSERT INTO users (username, salt, hash, iterations) VALUES ($1, $2, $3, $4)',
          ['testuser', user1Salt, user1Hash, 120000]
        );
        console.log('✅ 创建用户 testuser (密码: password123)');
      } catch (err) {
        if (err.code === '23505') {
          console.log('ℹ️  用户 testuser 已存在');
        } else {
          throw err;
        }
      }
      
      // 用户2: demo
      const user2Salt = crypto.randomBytes(16).toString('hex');
      const user2Hash = hashPassword('demo123', user2Salt, 120000);
      
      try {
        await client.query(
          'INSERT INTO users (username, salt, hash, iterations) VALUES ($1, $2, $3, $4)',
          ['demo', user2Salt, user2Hash, 120000]
        );
        console.log('✅ 创建用户 demo (密码: demo123)');
      } catch (err) {
        if (err.code === '23505') {
          console.log('ℹ️  用户 demo 已存在');
        } else {
          throw err;
        }
      }
      
      // 4. 创建示例密码条目
      console.log('\n🔐 创建示例密码条目...');
      
      // 为 testuser 创建密码条目
      const sampleEntries = [
        {
          owner: 'testuser',
          url: 'https://www.google.com',
          username: 'testuser@gmail.com',
          password_encrypted: 'encrypted_password_1',
          favicon_url: 'https://www.google.com/favicon.ico',
          note: 'Google账户',
          tags: ['搜索', '邮箱']
        },
        {
          owner: 'testuser',
          url: 'https://www.github.com',
          username: 'testuser',
          password_encrypted: 'encrypted_password_2',
          favicon_url: 'https://github.com/favicon.ico',
          note: 'GitHub账户',
          tags: ['代码', '开发']
        },
        {
          owner: 'demo',
          url: 'https://www.facebook.com',
          username: 'demo@facebook.com',
          password_encrypted: 'encrypted_password_3',
          favicon_url: 'https://www.facebook.com/favicon.ico',
          note: 'Facebook账户',
          tags: ['社交', '联系']
        }
      ];
      
      for (const entry of sampleEntries) {
        try {
          await client.query(
            `INSERT INTO password_entries (owner, url, username, password_encrypted, favicon_url, note, tags) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [entry.owner, entry.url, entry.username, entry.password_encrypted, entry.favicon_url, entry.note, entry.tags]
          );
          console.log(`✅ 为用户 ${entry.owner} 创建密码条目: ${entry.url}`);
        } catch (err) {
          console.log(`ℹ️  密码条目 ${entry.url} 可能已存在`);
        }
      }
      
      // 5. 提交事务
      await client.query('COMMIT');
      
      // 6. 显示数据库统计信息
      console.log('\n📊 数据库统计信息:');
      
      const userCount = await client.query('SELECT COUNT(*) FROM users');
      console.log(`👤 用户数量: ${userCount.rows[0].count}`);
      
      const entryCount = await client.query('SELECT COUNT(*) FROM password_entries');
      console.log(`🔐 密码条目数量: ${entryCount.rows[0].count}`);
      
      const userEntries = await client.query('SELECT owner, COUNT(*) as count FROM password_entries GROUP BY owner');
      userEntries.rows.forEach(row => {
        console.log(`   ${row.owner}: ${row.count} 个密码条目`);
      });
      
      console.log('\n🎉 数据初始化完成！');
      console.log('\n📌 示例用户信息：');
      console.log('   用户1: 用户名 testuser | 密码 password123');
      console.log('   用户2: 用户名 demo | 密码 demo123');
      console.log('\n📌 下一步：');
      console.log('1. 使用这些示例用户登录密码管理器');
      console.log('2. 查看和管理示例密码条目');
      console.log('3. 尝试添加新的密码条目');
      
    } catch (error) {
      // 回滚事务
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('\n❌ 初始化失败:', {
      error: error.message,
      code: error.code
    });
    
    if (error.code === 'ECONNREFUSED') {
      console.error('💡 解决方案：检查数据库连接字符串和服务状态');
    } else if (error.code === '23505') {
      console.error('💡 解决方案：数据已存在，无需重复初始化');
    }
    
    console.error('\n完整错误信息:');
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// 运行初始化
initSampleData();

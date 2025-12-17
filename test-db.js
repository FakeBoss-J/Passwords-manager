#!/usr/bin/env node

// 数据库连接测试脚本
// 使用方法：
// 1. 设置环境变量：set VERCEL_POSTGRES_URL=your-connection-string
// 2. 运行脚本：node test-db.js

import { Pool } from 'pg';

console.log('=== 密码管理器数据库连接测试工具 ===\n');

// 检测环境变量
const connectionString = process.env.VERCEL_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ 错误：未找到数据库连接字符串！');
  console.error('请设置以下环境变量之一：');
  console.error('- VERCEL_POSTGRES_URL (Vercel Postgres)');
  console.error('- POSTGRES_URL (Neon等其他服务)');
  console.error('- DATABASE_URL (通用PostgreSQL连接URL)');
  console.error('\n设置方法示例：');
  console.error('Windows: set VERCEL_POSTGRES_URL=your-connection-string');
  console.error('Linux/Mac: export VERCEL_POSTGRES_URL=your-connection-string');
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

// 测试连接
async function testConnection() {
  try {
    console.log('\n🔍 正在测试数据库连接...');
    
    // 测试基本连接
    const client = await pool.connect();
    console.log('✅ 数据库连接成功！');
    
    // 测试简单查询
    console.log('🔍 正在测试简单查询...');
    const result = await client.query('SELECT 1 AS test');
    console.log('✅ 查询成功！结果:', result.rows[0]);
    
    // 测试表结构
    console.log('\n📊 正在检查数据库表结构...');
    
    // 检查users表
    const usersTable = await client.query("SELECT to_regclass('public.users') AS table_exists");
    console.log('✅ users表:', usersTable.rows[0].table_exists ? '存在' : '不存在（将在首次使用时创建）');
    
    // 检查password_entries表
    const entriesTable = await client.query("SELECT to_regclass('public.password_entries') AS table_exists");
    console.log('✅ password_entries表:', entriesTable.rows[0].table_exists ? '存在' : '不存在（将在首次使用时创建）');
    
    // 如果表存在，显示一些统计信息
    if (usersTable.rows[0].table_exists) {
      const userCount = await client.query('SELECT COUNT(*) FROM users');
      console.log('📋 用户数量:', userCount.rows[0].count);
    }
    
    if (entriesTable.rows[0].table_exists) {
      const entryCount = await client.query('SELECT COUNT(*) FROM password_entries');
      console.log('📋 密码条目数量:', entryCount.rows[0].count);
    }
    
    client.release();
    
    console.log('\n🎉 所有测试通过！数据库配置正常。');
    console.log('\n📌 接下来的步骤：');
    console.log('1. 部署到Vercel：npm run deploy --prod');
    console.log('2. 在Vercel控制台检查日志');
    console.log('3. 测试前端功能');
    
    return true;
    
  } catch (error) {
    console.error('\n❌ 测试失败！错误详情：');
    console.error('错误信息:', error.message);
    console.error('错误代码:', error.code);
    
    // 提供解决方案
    if (error.code === 'ECONNREFUSED' || error.message.includes('connection')) {
      console.error('\n💡 解决方案：');
      console.error('1. 确保Vercel Postgres已正确集成到项目中');
      console.error('2. 检查环境变量是否完全正确');
      console.error('3. 验证数据库服务是否正在运行');
      console.error('4. 检查网络连接和防火墙设置');
    } else if (error.code === '42P01') {
      console.error('\n💡 解决方案：表不存在是正常的，首次使用时会自动创建');
    } else if (error.code === '42601') {
      console.error('\n💡 解决方案：SQL语法错误，请检查SQL语句');
    } else if (error.code === 'ENOTFOUND') {
      console.error('\n💡 解决方案：DNS解析错误，请检查连接字符串中的主机名');
    } else if (error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
      console.error('\n💡 解决方案：SSL证书错误，请确保ssl.rejectUnauthorized设置为false');
    }
    
    console.error('\n📋 完整错误堆栈：');
    console.error(error.stack);
    
    return false;
  } finally {
    await pool.end();
  }
}

// 运行测试
testConnection()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error('❌ 测试过程中发生未捕获错误:', err);
    process.exit(1);
  });
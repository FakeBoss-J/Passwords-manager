# SecureVault Vercel 部署与数据库连接教程

## 1. 项目准备

### 1.1 检查项目结构
确保您的项目结构如下：
```
product/
├── api/
│   └── index.js          # API 处理逻辑
├── public/
│   └── index.html        # 前端页面
├── server/
│   └── server.js         # 本地服务器
├── package.json          # 项目配置
└── vercel.json           # Vercel 配置
```

### 1.2 确认依赖
检查 `package.json` 中是否包含必要的依赖：
```json
{
  "dependencies": {
    "pg": "^8.11.3"
  },
  "devDependencies": {
    "vercel": "^33.5.2"
  }
}
```

## 2. Vercel 部署步骤

### 2.1 创建 Vercel 账户
- 访问 [Vercel 官网](https://vercel.com/) 并注册账户
- 连接您的 GitHub/GitLab/Bitbucket 账户

### 2.2 安装 Vercel CLI
在项目根目录执行：
```bash
npm install -g vercel
```

### 2.3 登录 Vercel
```bash
vercel login
```
根据提示完成登录验证。

### 2.4 初始化项目
```bash
vercel init
```
选择或创建项目，按照提示完成配置。

### 2.5 部署项目
```bash
vercel deploy
```

## 3. 数据库配置

### 3.1 选择数据库
您可以选择以下两种数据库方案：

#### 方案 A: Vercel Postgres (推荐)
1. 在 Vercel 项目中，点击 "Storage" 选项卡
2. 点击 "Create Database" 按钮
3. 选择 "Postgres" 并完成创建
4. Vercel 会自动配置环境变量

#### 方案 B: Neon 数据库
1. 访问 [Neon 官网](https://neon.tech/) 并注册账户
2. 创建新的数据库项目
3. 在 "Connection Details" 中获取连接字符串

### 3.2 配置数据库连接

#### 方案 A: Vercel Postgres
Vercel 会自动设置以下环境变量：
- `POSTGRES_URL`
- `POSTGRES_URL_NON_POOLING`
- `POSTGRES_USER`
- `POSTGRES_HOST`
- `POSTGRES_PASSWORD`
- `POSTGRES_DATABASE`

#### 方案 B: Neon 数据库
在 Vercel 项目的 "Settings" -> "Environment Variables" 中添加：
- `DATABASE_URL` = Neon 连接字符串

## 4. 配置文件检查

### 4.1 检查 `vercel.json`
确保您的 `vercel.json` 配置正确：
```json
{
  "version": 2,
  "functions": {
    "api/index.js": {
      "memory": 128,
      "maxDuration": 10
    }
  },
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "/api/index.js"
    },
    {
      "source": "/(.*)",
      "destination": "/public/$1"
    }
  ]
}
```

### 4.2 检查数据库连接代码
确保 `api/index.js` 中正确处理了数据库连接：
```javascript
// 数据库连接配置
let pool = null;

try {
  const connectionString = process.env.VERCEL_POSTGRES_URL || 
                           process.env.POSTGRES_URL || 
                           process.env.DATABASE_URL;
  
  if (!connectionString) {
    console.error('ERROR: 未找到数据库连接字符串！');
    process.exit(1);
  }
  
  pool = new Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });
} catch (error) {
  console.error('数据库连接错误:', error);
}
```

## 5. 部署验证

### 5.1 查看部署日志
部署完成后，查看日志确保没有错误：
```bash
vercel logs
```

### 5.2 测试 API 端点
使用 curl 或 Postman 测试 API 端点：
```bash
# 测试数据库连接
curl -X GET https://your-deployment-url/api/test

# 测试用户注册
curl -X POST https://your-deployment-url/api/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"testpassword"}'
```

### 5.3 验证前端页面
访问部署后的 URL，测试前端功能是否正常：
- 注册新用户
- 登录
- 添加密码条目
- 查看和编辑条目

## 6. 数据库初始化

### 6.1 使用初始化脚本
您可以使用 `init-data.js` 脚本添加示例数据：
1. 在本地设置数据库连接环境变量
2. 执行脚本：
   ```bash
   node init-data.js
   ```

### 6.2 手动初始化
如果您不想使用脚本，可以通过 API 手动初始化：
1. 注册新用户
2. 登录获取令牌
3. 使用令牌添加密码条目

## 7. 常见问题解决

### 7.1 数据库连接错误
- 检查环境变量是否正确设置
- 确保数据库服务正在运行
- 验证连接字符串格式

### 7.2 部署错误
- 检查 `vercel.json` 配置是否正确
- 确保所有依赖都在 `package.json` 中声明
- 查看部署日志获取详细错误信息

### 7.3 API 端点 404
- 检查路由配置是否正确
- 确保 API 文件路径正确
- 验证 Vercel 重写规则

## 8. 性能优化

### 8.1 数据库连接池
确保使用连接池管理数据库连接，避免频繁创建和关闭连接。

### 8.2 缓存策略
对于不经常变化的数据，可以实现缓存机制，减少数据库查询次数。

### 8.3 索引优化
为常用查询字段创建索引，提高查询性能：
```sql
CREATE INDEX idx_password_entries_username ON password_entries(username);
CREATE INDEX idx_password_entries_category ON password_entries(category);
```

## 9. 安全注意事项

### 9.1 环境变量
- 不要在代码中硬编码敏感信息
- 使用 Vercel 环境变量管理敏感数据
- 定期更新数据库密码

### 9.2 数据加密
- 确保密码在客户端加密后再存储
- 使用 HTTPS 保护数据传输
- 定期备份数据库

### 9.3 访问控制
- 实现适当的用户认证和授权机制
- 限制 API 访问频率，防止滥用

## 10. 后续维护

### 10.1 监控和日志
- 启用 Vercel 监控功能
- 定期查看应用日志
- 设置错误告警

### 10.2 备份策略
- 配置定期数据库备份
- 测试备份恢复流程
- 存储备份在安全位置

### 10.3 更新和升级
- 定期更新依赖包
- 应用安全补丁
- 测试新版本兼容性

## 11. 联系方式

如果您在部署过程中遇到问题，可以：
- 查看 `TROUBLESHOOTING.md` 文档
- 检查 Vercel 和数据库服务的官方文档
- 提交 Issue 到项目仓库

---

**祝您部署顺利！** 🎉
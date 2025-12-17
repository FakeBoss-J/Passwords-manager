# Troubleshooting Guide for SecureVault

## Common Issues and Solutions

### 1. Database Connection Issues

#### Error: "未找到数据库连接字符串"
**Problem**: The application can't find a database connection string.
**Solution**:
1. Ensure you have configured one of the following environment variables:
   - `VERCEL_POSTGRES_URL` (for Vercel Postgres)
   - `POSTGRES_URL` (for Neon and other PostgreSQL services)
   - `DATABASE_URL` (for general PostgreSQL connections)
2. In Vercel: Go to Project Settings → Environment Variables
3. In Neon: Go to Project Settings → Connection Details → Connection String
4. Copy the full connection string (including username, password, host, port, database name)
5. Ensure the environment variable is set for all environments (Development, Preview, Production)

#### Error: "连接超时" or "ECONNREFUSED"
**Problem**: The application can't establish a connection to the database.
**Solution**:
1. Verify that your PostgreSQL service (Neon/Vercel Postgres) is running
2. Check that your database server allows connections from Vercel's IP ranges
   - For Neon: Connections are automatically allowed from all IPs
   - For Vercel Postgres: Connections are automatically configured
3. Test the connection string locally using the `test-db.js` script:
   ```bash
   node test-db.js
   ```
4. Ensure the connection string is properly formatted (no missing components)

#### Error: "表不存在" or "relation does not exist"
**Problem**: The database tables haven't been created yet.
**Solution**:
1. The application should automatically create tables on first API request
2. Try making an API request (e.g., register a new user)
3. Check the Vercel logs for database initialization errors
4. Use the `init-data.js` script to create tables and sample data

### 2. Authentication Issues

#### Error: "Invalid credentials"
**Problem**: Login failed due to incorrect username or password.
**Solution**:
1. Verify that the username and password are correct
2. Check that the user exists in the database
3. Ensure that password encryption/decryption is working correctly

#### Error: "Unauthorized" or "Token expired"
**Problem**: The authentication token is missing or expired.
**Solution**:
1. Log out and log in again to get a new token
2. Ensure that the token is being sent in the Authorization header
3. Check that the token hasn't expired (tokens are valid for 24 hours)

### 3. Deployment Issues

#### Warning: "Due to `builds` existing in your configuration file, the Build and Development Settings defined in your Project Settings will not apply."
**Problem**: The vercel.json configuration uses outdated `builds` and `routes` syntax.
**Solution**:
1. Update vercel.json to use modern Vercel configuration format:
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
       },
       {
         "source": "/",
         "destination": "/public/index.html"
       }
     ]
   }
   ```

#### Error: "Build failed" on Vercel
**Problem**: The Vercel build process failed.
**Solution**:
1. Check the build logs in Vercel for specific error messages
2. Ensure all dependencies are correctly listed in `package.json`
3. Verify that the project structure matches Vercel's requirements
4. Test the build locally using `vercel build`
5. Ensure that vercel.json is using the correct configuration format

#### Error: "500 Server Error" when accessing the app
**Problem**: The server encountered an error while processing the request.
**Solution**:
1. Check the Vercel function logs for error details
2. Look for database connection errors
3. Ensure all required environment variables are set
4. Check for syntax errors in the API code
5. Verify that the API is correctly handling all request methods and paths

#### Error: "Database error" displayed on the frontend
**Problem**: The API returned a database error to the frontend.
**Solution**:
1. Check the Vercel function logs for the specific database error
2. Verify that the database connection string is correctly configured
3. Ensure that the database tables have been created
4. Check if the database server is running and accessible
5. Use the `test-db.js` script to test the database connection locally

### 4. Frontend Issues

#### Error: "API request failed"
**Problem**: The frontend can't connect to the API.
**Solution**:
1. Ensure that the API is running and accessible
2. Check the browser console for network errors
3. Verify that the API endpoint URLs are correct (using relative paths)
4. Ensure CORS headers are properly configured
5. Check that the API is returning the expected response format

#### Error: "Password encryption failed"
**Problem**: The frontend failed to encrypt a password.
**Solution**:
1. Check that the Web Crypto API is available in your browser
2. Ensure that the encryption keys are being generated correctly
3. Verify that the password is in the correct format

## Debugging Tips

### 1. Check Vercel Logs
1. Go to your Vercel project dashboard
2. Click on "Functions" in the left sidebar
3. Select the `api/index.js` function
4. View the logs to see error messages and debug information
5. Look for database connection errors and API request details

### 2. Test Locally
1. Run the application locally using `npm run dev`
2. Test API endpoints using tools like Postman or curl
3. Use the browser's developer tools to debug frontend issues
4. Test database connection using `test-db.js`
5. Check the console for error messages

### 3. Use Environment Variables
1. Ensure that environment variables are set correctly in Vercel
2. Test with different database connection strings
3. Enable debug logging by setting `NODE_ENV=development`
4. Check that all required environment variables are available to the function

### 4. Database Debugging
1. Use the `init-data.js` script to create sample data
2. Check the database tables and data using Neon's SQL Editor or Vercel Postgres Dashboard
3. Verify that the database schema matches the expected structure
4. Test SQL queries directly in the database console

## Deployment Configuration Best Practices

1. **Use Modern Vercel Configuration**:
   - Replace `builds` with `functions`
   - Replace `routes` with `rewrites`
   - Configure function memory and timeout settings

2. **Database Configuration**:
   - Use `VERCEL_POSTGRES_URL` for Vercel Postgres
   - Use `POSTGRES_URL` for Neon
   - Support multiple connection strings for flexibility
   - Enable SSL for secure connections

3. **API Design**:
   - Use relative paths for API calls in the frontend
   - Implement proper error handling
   - Use CORS headers to allow cross-origin requests
   - Add rate limiting for security

4. **Frontend Configuration**:
   - Use relative paths for API endpoints
   - Implement proper error handling for API calls
   - Use HTTPS in production
   - Optimize static assets

## Contact Support

If you're still having issues after trying these solutions:
1. Check the [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md) for detailed deployment instructions
2. Review the application code for custom configurations
3. Check the Vercel and Neon documentation for platform-specific issues
4. Contact your database service provider (Neon/Vercel Postgres) for database-specific issues
# Deployment Guide for yt-video-summariser

## Quick Deploy to Vercel

### Prerequisites
- Vercel account (free at [vercel.com](https://vercel.com))
- API Keys required:
  - `PUTER_AUTH_TOKEN` - For Puter.js v2 server-side AI (optional, client uses user-pays model)

### Option 1: Vercel CLI (Recommended)

1. Install Vercel CLI if not already installed:
```bash
npm install -g vercel
```

2. Login to Vercel:
```bash
vercel login
```

3. Deploy to production:
```bash
vercel --prod
```

4. Set environment variables in Vercel Dashboard:
   - Go to your project settings → Environment Variables
   - Add `PUTER_AUTH_TOKEN`: Obtain via `node setup-puter-auth.js`

5. Redeploy after setting variables:
```bash
vercel --prod
```

### Option 2: Vercel Browser

1. Push your code to GitHub
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import the repository
4. Set environment variables in the project settings
5. Deploy

---

## Deploy to Render

### Prerequisites
- Render account (free at [render.com](https://render.com))
- API Keys (PUTER_AUTH_TOKEN)

### Steps

1. Create a `render.yaml` file (already included)
2. Connect your GitHub repository to Render
3. Click "New +" → Select "Web Service"
4. Configure:
   - Name: `yt-video-summariser`
   - Root Directory: `.`
   - Build Command: `npm run build`
   - Start Command: `node server/index.js`
5. Set environment variables in the dashboard
6. Deploy

---

## Deploy to Railway

### Prerequisites
- Railway account (free tier available)
- API Keys

### Steps

1. Install Railway CLI:
```bash
npm install -g @railway/cli
```

2. Login:
```bash
railway login
```

3. Initialize and deploy:
```bash
railway init
railway up
```

4. Set environment variables:
```bash
railway variables set PUTER_AUTH_TOKEN=your_token_here
```

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PUTER_AUTH_TOKEN` | Puter.js v2 auth token for server-side AI | Optional |

---

## Important Notes

### In-Memory Storage Limitation
The current implementation uses in-memory storage (`Map` objects) for:
- Saved summaries
- Chat histories
- User credits

**Impact:** On serverless platforms (Vercel, Render, etc.), data will be lost when:
- Functions cold restart
- Server instances restart
- Deployments occur

**Solutions:**
1. For production, add a database (Redis, MongoDB, PostgreSQL)
2. Use a platform with persistent storage
3. Accept that data is ephemeral during demos/testing

### Getting API Keys

**Gemini API Key:**
1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Click "Create API Key"
3. Copy and use as `GEMINI_API_KEY`

**Puter Auth Token:**
1. Run `node setup-puter-auth.js`
2. Follow the browser login flow
3. Copy the token and use as `PUTER_AUTH_TOKEN`

---

## Post-Deployment Checklist

- [ ] Environment variables are set
- [ ] App loads at the deployed URL
- [ ] Video summarization works with a test URL
- [ ] Chat functionality works
- [ ] Summary sharing produces valid URLs
- [ ] Credits display correctly

---

## Troubleshooting

### Build Fails
- Check `package.json` scripts
- Ensure `node_modules` is in `.gitignore`
- Verify TypeScript compiles: `npm run build`

### API Errors
- Verify environment variables are set
- Check API keys are valid and not expired
- Review API quota limits

### 404 Errors
- Check `vercel.json` routing configuration
- Ensure `dist` folder is built before deployment

### Data Not Persisting
- Note: This is expected with current in-memory storage
- Consider adding a database for production use

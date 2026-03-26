import 'dotenv/config';
import https from 'https';
import fs from 'fs';
import { URL } from 'url';

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REDIRECT_URI = 'https://social.thirdwavebbq.com.au:3457/oauth/callback';
const SCOPES = 'https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/business.manage';

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
  + '?client_id=' + CLIENT_ID
  + '&redirect_uri=' + encodeURIComponent(REDIRECT_URI)
  + '&response_type=code'
  + '&scope=' + encodeURIComponent(SCOPES)
  + '&access_type=offline'
  + '&prompt=consent';

console.log('\n=== YouTube OAuth Setup ===');
console.log('\nOpen this URL in your browser:\n');
console.log(authUrl);
console.log('\nWaiting for callback...\n');

const server = https.createServer({
  cert: fs.readFileSync('/etc/letsencrypt/live/social.thirdwavebbq.com.au/fullchain.pem'),
  key: fs.readFileSync('/etc/letsencrypt/live/social.thirdwavebbq.com.au/privkey.pem'),
}, async (req, res) => {
  const url = new URL(req.url, 'https://social.thirdwavebbq.com.au:3457');
  if (url.pathname === '/oauth/callback') {
    const code = url.searchParams.get('code');
    if (!code) {
      res.end('No code received');
      return;
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenRes.json();
    if (tokens.refresh_token) {
      console.log('\n=== SUCCESS ===');
      console.log('Refresh token:', tokens.refresh_token);
      console.log('\nAdd this to your .env as YOUTUBE_REFRESH_TOKEN');
      res.end('Success! You can close this window. Check the terminal for your refresh token.');
    } else {
      console.log('Error:', JSON.stringify(tokens));
      res.end('Error: ' + JSON.stringify(tokens));
    }
    setTimeout(() => process.exit(0), 2000);
  }
});

server.listen(3457, () => {
  console.log('Listening on port 3457 for callback...');
});

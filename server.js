const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files (index.html, style.css, script.js)
app.use(express.static('./'));

// Secure Proxy Endpoint simulating Vercel Serverless Behavior locally
app.get('/api/tmdb', async (req, res) => {
    const { path } = req.query;
    
    if (!path) return res.status(400).json({ error: 'Path parameter is required' });

    try {
        const url = new URL(`${TMDB_BASE_URL}${path}`);
        
        for (const [key, value] of Object.entries(req.query)) {
            if (key !== 'path') {
                url.searchParams.append(key, value);
            }
        }
        
        url.searchParams.append('api_key', TMDB_API_KEY);
        
        const response = await fetch(url.toString());
        const data = await response.json();
        
        if (!response.ok) {
            return res.status(response.status).json(data);
        }
        res.json(data);
    } catch (error) {
        console.error('TMDB Proxy Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.listen(PORT, () => {
    console.log(`VAILISM Server running securely on http://localhost:${PORT}`);
});

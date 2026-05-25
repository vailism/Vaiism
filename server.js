const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname)));

// API Proxy Endpoint mirroring api/tmdb.js for local development
app.get('/api/tmdb', async (req, res) => {
    const { path: tmdbPath } = req.query;
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
    
    if (!tmdbPath) {
        return res.status(400).json({ error: 'Path parameter is required' });
    }

    try {
        const url = new URL(`${TMDB_BASE_URL}${tmdbPath}`);
        
        // Map existing query params to target server
        for (const [key, value] of Object.entries(req.query)) {
            if (key !== 'path') {
                url.searchParams.append(key, value);
            }
        }
        
        // Inject API Key
        url.searchParams.append('api_key', TMDB_API_KEY);
        
        const tmdbResponse = await fetch(url.toString());
        const data = await tmdbResponse.json();
        
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET');
        
        res.status(tmdbResponse.status).json(data);
    } catch (error) {
        console.error('Local TMDB Proxy Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`[VAILISM] Development server running at http://localhost:${PORT}`);
});

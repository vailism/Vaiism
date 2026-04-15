export default async function handler(request, response) {
  const { path } = request.query;
  const TMDB_API_KEY = process.env.TMDB_API_KEY;
  const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
  
  if (!path) return response.status(400).json({ error: 'Path parameter is required' });

  try {
    const url = new URL(`${TMDB_BASE_URL}${path}`);
    
    // Map existing query params to target server seamlessly
    for (const [key, value] of Object.entries(request.query)) {
      if (key !== 'path') {
        url.searchParams.append(key, value);
      }
    }
    
    // Inject Private KEY invisibly server-side
    url.searchParams.append('api_key', TMDB_API_KEY);
    
    const tmdbResponse = await fetch(url.toString());
    const data = await tmdbResponse.json();
    
    // CORS headers for local/cross-origin safety during Vercel deployments
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET');
    
    return response.status(tmdbResponse.status).json(data);
  } catch (error) {
    console.error('Vercel TMDB Proxy Error:', error);
    return response.status(500).json({ error: error.message });
  }
}

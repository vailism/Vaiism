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
    
    // ── Intelligent Edge Caching based on endpoint type ──────────────
    // Search results: no cache (user-specific, changes per keystroke)
    // Trending/popular: 1 hour cache (updates daily on TMDB)
    // Movie/TV details: 24 hour cache (metadata rarely changes)
    let cacheHeader = 's-maxage=3600, stale-while-revalidate=600';
    if (path.includes('/search/')) {
      cacheHeader = 's-maxage=300, stale-while-revalidate=60';
    } else if (/^\/(movie|tv)\/\d+/.test(path) && !path.includes('/similar') && !path.includes('/season/')) {
      cacheHeader = 's-maxage=86400, stale-while-revalidate=3600';
    }
    response.setHeader('Cache-Control', cacheHeader);
    
    // CORS headers for local/cross-origin safety during Vercel deployments
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET');
    
    return response.status(tmdbResponse.status).json(data);
  } catch (error) {
    console.error('Vercel TMDB Proxy Error:', error);
    return response.status(500).json({ error: error.message });
  }
}

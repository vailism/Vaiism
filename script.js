// VAILISM - Netflix Clone Logic

// Basic Backend Router Setup (Protects API Key)
const BASE_URL = '/api/tmdb'; // Points to Vercel Serverless Function
const IMG_BASE_URL = 'https://image.tmdb.org/t/p/w500';
const HERO_IMG_URL = 'https://image.tmdb.org/t/p/original';

const ENDPOINTS = [
    { title: "Trending Now", path: "/trending/all/week" },
    { title: "Popular Choices", path: "/movie/popular" },
    { title: "Top Rated", path: "/movie/top_rated" },
    { title: "Action Hits", path: "/discover/movie?with_genres=28" },
    { title: "Comedy Hits", path: "/discover/movie?with_genres=35" },
    { title: "Horror", path: "/discover/movie?with_genres=27" },
    { title: "Sci-Fi & Fantasy", path: "/discover/movie?with_genres=878" },
    { title: "Romance", path: "/discover/movie?with_genres=10749" },
    { title: "Documentaries", path: "/discover/movie?with_genres=99" }
];

let globalCategoryIndex = 0;
let apiKeyErrorShown = false;

// Generic Fetch Function
async function fetchMovies(endpoint, page = 1) {
    try {
        const pathBlock = encodeURIComponent(endpoint.split('?')[0]);
        const paramsBlock = endpoint.includes('?') ? (endpoint.split('?')[1] + '&') : '';
        const res = await fetch(`${BASE_URL}?path=${pathBlock}&${paramsBlock}page=${page}`);
        
        // Handle rate limiting gracefully
        if(res.status === 429) {
            console.warn("TMDB Rate Limit reached. Waiting...");
            await new Promise(r => setTimeout(r, 1000));
            return fetchMovies(endpoint, page);
        }
        
        const data = await res.json();
        return data.results || [];
    } catch (e) {
        console.error('Failed to fetch from API Proxy:', e);
        return [];
    }
}

// Navigate to player
window.playMovie = function(id, type = 'movie') {
    if (!id) return;
    window.location.href = `player.html?id=${id}&type=${type}`;
};

// Start logic when DOM is completely loaded
document.addEventListener('DOMContentLoaded', () => {
    
    // Navbar Effects
    const navbar = document.getElementById('navbar');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) navbar.classList.add('scrolled');
        else navbar.classList.remove('scrolled');
    });

    // Hero Rendering
    async function loadHeroBanner() {
        const movies = await fetchMovies('/trending/all/week');
        if (!movies || movies.length === 0) return;
        
        // Pick a random highly rated movie from the first page
        const movie = movies[Math.floor(Math.random() * Math.min(movies.length, 5))];
        const type = movie.media_type || (movie.name ? 'tv' : 'movie');
        
        const heroTitle = document.getElementById('hero-title');
        const heroDesc = document.getElementById('hero-desc');
        const heroPlay = document.getElementById('hero-play');
        const heroHeader = document.getElementById('hero');
        
        // Remove skeletons
        if(heroTitle) heroTitle.classList.remove('skeleton-text');
        if(heroDesc) heroDesc.classList.remove('skeleton-text');
        
        // Ensure image paths exist to prevent null errors
        const heroBg = movie.backdrop_path ? movie.backdrop_path : movie.poster_path;
        if (heroBg && heroHeader) {
            heroHeader.style.backgroundImage = `url(${HERO_IMG_URL}${heroBg})`;
        }
        
        if (heroTitle) heroTitle.textContent = movie.title || movie.name || "Featured Movie";
        if (heroDesc) heroDesc.textContent = movie.overview || "An amazing movie to watch on VAILISM.";
        
        if (heroPlay) {
            heroPlay.style.display = 'flex';
            heroPlay.onclick = () => playMovie(movie.id, type);
        }
        
        // Set more info button to visible
        const btnInfo = document.querySelector('.btn-info');
        if (btnInfo) btnInfo.style.display = 'flex';
        
        if(window.lucide) window.lucide.createIcons();
    }

    // Append movies logic extracting card building
    function appendMoviesToContainer(movies, container) {
        movies.forEach(movie => {
            if (!movie.poster_path && !movie.backdrop_path) return;
            
            // CRITICAL FIX: Ensure entirely unique elements, skipping exact duplicates
            if (container.querySelector(`[data-id="${movie.id}"]`)) return;
            
            const type = movie.media_type || (movie.name ? 'tv' : 'movie');
            
            const card = document.createElement('div');
            card.classList.add('card');
            card.dataset.id = movie.id;
            card.onclick = () => playMovie(movie.id, type);
            
            const imgPath = movie.poster_path ? movie.poster_path : movie.backdrop_path;
            
            card.innerHTML = `
                <img src="${IMG_BASE_URL}${imgPath}" alt="${movie.title || movie.name || 'Movie'}" loading="lazy">
                <div class="card-overlay">
                    <span style="font-weight: 600; font-size: 14px; text-shadow:1px 1px 2px rgba(0,0,0,1); color: white;">
                        ${movie.title || movie.name || ""}
                    </span>
                    <div class="play-icon"><i data-lucide="play" fill="currentColor" size="16"></i></div>
                </div>
            `;
            container.appendChild(card);
        });
        
        if(window.lucide) window.lucide.createIcons();
    }

    // Horizontal Infinite Scroll
    async function handleHorizontalScroll(rowElement, rowSection) {
        const remainingScroll = rowElement.scrollWidth - rowElement.scrollLeft - rowElement.clientWidth;
        if (remainingScroll < 300 && !rowElement.dataset.fetching) {
            rowElement.dataset.fetching = "true";
            
            let nextPage = parseInt(rowSection.dataset.page) + 1;
            rowSection.dataset.page = nextPage;
            
            // Skeletons
            for(let i=0; i<4; i++) {
                const skeleton = document.createElement('div');
                skeleton.classList.add('card', 'skeleton');
                rowElement.appendChild(skeleton);
            }
            
            const path = rowSection.dataset.path;
            const movies = await fetchMovies(path, nextPage);
            
            // Remove temporary skeletons
            const skeletons = rowElement.querySelectorAll('.skeleton');
            skeletons.forEach(s => s.remove());
            
            appendMoviesToContainer(movies, rowElement);
            rowElement.dataset.fetching = "";
        }
    }

    // Row Rendering
    async function renderRow(categoryDef) {
        const mainContent = document.getElementById('main-content');
        if (!mainContent) return; // Fault tolerance
        
        const rowSection = document.createElement('section');
        rowSection.classList.add('row');
        rowSection.dataset.page = "1";
        rowSection.dataset.path = categoryDef.path;

        const rowHeader = document.createElement('h2');
        rowHeader.classList.add('row-header');
        rowHeader.textContent = categoryDef.title;

        const rowPosters = document.createElement('div');
        rowPosters.classList.add('row-posters');
        
        // Initial Skeletons
        for(let i=0; i<6; i++) {
            const skeleton = document.createElement('div');
            skeleton.classList.add('card', 'skeleton');
            rowPosters.appendChild(skeleton);
        }
        
        rowSection.appendChild(rowHeader);
        rowSection.appendChild(rowPosters);
        mainContent.appendChild(rowSection);

        const movies = await fetchMovies(categoryDef.path, 1);
        
        // Flush skeletons immediately once fetched
        rowPosters.innerHTML = '';
        
        if (movies && movies.length > 0) {
            appendMoviesToContainer(movies, rowPosters);
        } else {
            rowPosters.style.display = 'block';
            rowPosters.innerHTML = `
                <div style="padding: 20px; color: #ff4444; background: rgba(229, 9, 20, 0.1); border: 1px solid #e50914; border-radius: 4px; display: inline-block;">
                    <strong>Vercel/Node Backend Offline.</strong><br>
                    VAILISM securely hides its API key in the backend.<br>
                    Please start the local server by running <code>npm install && npm start</code> in your terminal, or viewing via Vercel.
                </div>
            `;
        }
        
        // Setup Horizontal Infinite Fetch
        rowPosters.addEventListener('scroll', () => handleHorizontalScroll(rowPosters, rowSection));
    }

    // Continue Watching Row Tracking Engine
    async function loadContinueWatching() {
        const keys = Object.keys(localStorage).filter(k => k.startsWith('vailism_progress_'));
        if (keys.length === 0) return;

        const mainContent = document.getElementById('main-content');
        if (!mainContent) return;
        
        const rowSection = document.createElement('section');
        rowSection.classList.add('row');
        rowSection.dataset.unlimited = "false";

        const rowHeader = document.createElement('h2');
        rowHeader.classList.add('row-header');
        rowHeader.textContent = "Continue Watching";
        
        const rowPosters = document.createElement('div');
        rowPosters.classList.add('row-posters');
        
        // Push row strictly above standard fetching grids
        mainContent.insertBefore(rowSection, mainContent.firstChild);
        rowSection.appendChild(rowHeader);
        rowSection.appendChild(rowPosters);
        
        // Compile saved videos mapping IDs robustly 
        keys.forEach(async key => {
            try {
                const movieId = key.replace('vailism_progress_', '');
                const savedData = JSON.parse(localStorage.getItem(key));
                const typePath = savedData.season ? 'tv' : 'movie';
                
                const res = await fetch(`/api/tmdb?path=/${typePath}/${movieId}`);
                const data = await res.json();
                
                if (data && (data.poster_path || data.backdrop_path)) {
                    const card = document.createElement('div');
                    card.classList.add('card');
                    card.onclick = () => playMovie(movieId, typePath);
                    
                    const imgPath = data.poster_path || data.backdrop_path;
                    
                    // Render progress bar calculations
                    const percentComplete = (savedData.timestamp / savedData.duration) * 100;
                    
                    card.innerHTML = `
                        <img src="${IMG_BASE_URL}${imgPath}" alt="${data.title || data.name || 'Movie'}">
                        <div style="height:4px;width:100%;background:rgba(255,255,255,0.2);position:absolute;bottom:0px;"><div style="height:100%;width:${percentComplete}%;background:var(--primary-red);"></div></div>
                        <div class="card-overlay">
                            <span style="font-weight: 600; font-size: 14px; text-shadow:1px 1px 2px rgba(0,0,0,1); color: white;">
                                ${data.title || data.name || ""}
                            </span>
                            <div class="play-icon"><i data-lucide="play" fill="currentColor" size="16"></i></div>
                        </div>
                    `;
                    rowPosters.appendChild(card);
                    if(window.lucide) window.lucide.createIcons();
                }
            } catch (e) {
                // Failsafe cache corruption bypass
            }
        });
    }

    // Vertical Infinite Scroll (Loading new rows)
    async function loadMoreRows() {
        if (document.body.dataset.fetchingVertical === "true") return;
        document.body.dataset.fetchingVertical = "true";
        
        for(let i=0; i<2; i++) {
            if (globalCategoryIndex < ENDPOINTS.length) {
                await renderRow(ENDPOINTS[globalCategoryIndex]);
                globalCategoryIndex++;
            }
        }
        
        document.body.dataset.fetchingVertical = "false";
    }

    window.addEventListener('scroll', () => {
        // Determine bottom
        if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 600) {
            loadMoreRows();
        }
    });

    // Setup Search Selectors Inside DOM Load
    const searchIcon = document.querySelector('.search-icon');
    const searchContainer = document.querySelector('.search-container');
    const searchInput = document.getElementById('search-input');
    const appContent = document.getElementById('app-content');
    const searchView = document.getElementById('search-view');
    const searchResults = document.getElementById('search-results');

    // Toggle Search UI safely
    if (searchIcon && searchContainer && searchInput) {
        searchIcon.addEventListener('click', () => {
            searchContainer.classList.toggle('active');
            if (searchContainer.classList.contains('active')) {
                searchInput.focus();
            } else {
                closeSearch();
            }
        });
    }

    function closeSearch() {
        if(searchContainer) searchContainer.classList.remove('active');
        if(searchInput) searchInput.value = '';
        if(searchView) searchView.classList.add('hidden');
        if(appContent) appContent.classList.remove('hidden');
    }

    // Debounce Function
    function debounce(func, delay) {
        let timeoutId;
        return (...args) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(null, args), delay);
        };
    }

    async function searchMovies(query) {
        if (!query.trim()) {
            if(searchView) searchView.classList.add('hidden');
            if(appContent) appContent.classList.remove('hidden');
            return;
        }
        
        if(appContent) appContent.classList.add('hidden');
        if(searchView) searchView.classList.remove('hidden');
        if(searchResults) {
            searchResults.innerHTML = '';
            // Add skeletons for search
            for(let i=0; i<10; i++) {
                const skeleton = document.createElement('div');
                skeleton.classList.add('card', 'skeleton');
                searchResults.appendChild(skeleton);
            }
        }
        
        const url = `/search/multi?query=${encodeURIComponent(query)}&include_adult=false`;
        const movies = await fetchMovies(url, 1);
        
        if (searchResults) {
            searchResults.innerHTML = '';
            if (movies.length === 0) {
                searchResults.innerHTML = '<h3 style="color:var(--text-muted);">No results found.</h3>';
                return;
            }
            appendMoviesToContainer(movies, searchResults);
        }
    }

    if (searchInput) {
        const debouncedSearch = debounce((e) => searchMovies(e.target.value), 500);
        searchInput.addEventListener('input', debouncedSearch);
    }

    // Boot Up
    loadHeroBanner();
    loadContinueWatching();
    loadMoreRows();
});

# VAILISM — Netflix-style Streaming UI

## Description

VAILISM is a premium, Netflix-inspired streaming web application designed to deliver an infinite, seamless catalog of content. It features a modern, responsive frontend built entirely with core web technologies, utilizing a secure serverless Vercel engine to safely fetch and proxy dynamic metadata from the TMDB API without compromising client-side security.

## Features

- **Netflix-style UI**: Polished interface with scale-on-hover card expansions, horizontal scroll snapping, and atmospheric hero gradients.
- **Dynamic movie loading (TMDB)**: Real-time acquisition and categorization of global media endpoints.
- **Infinite scroll**: Dual-layer intersection tracking automatically loads subsequent pages across horizontal rows and vertical categories.
- **Search functionality**: Debounced real-time query system traversing native database indices.
- **Serverless API**: Architecture designed to obscure API tokens via Vercel edge functions.
- **Responsive design**: Seamless layout adaptation scaling gracefully from ultra-wide desktops down to mobile viewports.

## Tech Stack

- **HTML5**
- **CSS3** (Variables, Flexbox/CSS Grid, Transforms)
- **Vanilla JavaScript** (ES6+, asynchronous fetch)
- **Vercel** (Serverless backend functions)
- **TMDB API** (Database mapping)

## Project Structure

```text
📦 vailism
├── 📁 api/
│   └── tmdb.js          # Vercel serverless proxy route
├── 📁 screenshots/      # Application previews
├── index.html           # Main SPA architecture
├── player.html          # Dynamic iframe embedding portal
├── style.css            # Stylesheets and native animations
├── script.js            # Client-side component logic
├── server.js            # Local development node proxy
├── vercel.json          # Deployment configuration
├── .env                 # Local private credential registry
└── .gitignore           # Ignored deployment tracks
```

## Setup Instructions

To run VAILISM locally, you'll need Node.js installed to boot the routing wrapper.

1. **Clone Repo**
   ```bash
   git clone https://github.com/your-username/vailism.git
   cd vailism
   ```

2. **Environment Variables**
   Create a `.env` file in the root directory. Store your private API authorization string here:
   ```env
   TMDB_API_KEY=your_private_api_key_here
   ```

3. **Install Dependencies & Vercel CLI** (Optional for deployment)
   ```bash
   npm install
   ```

4. **Run Locally**
   Standard Node environment loop:
   ```bash
   npm start
   ```
   Navigate to `http://localhost:3000`.

## Deployment

VAILISM is fully configured to instantly deploy using Vercel.

1. Upload or push your structured repository to a GitHub repository.
2. Link the repository globally within your Vercel Dashboard.
3. Navigate to **Settings > Environment Variables** within your Vercel project and manually input your `TMDB_API_KEY`.
4. Deploy to generate your production URL. Vercel automatically deploys `api/tmdb.js` as an edge function.

## Security Note

VAILISM implements a rigid client-server decoupling mechanism regarding API requests. All active configuration strings, payloads, and tokens are stored absolutely strictly in `.env` blocks parsed out of sight via secure serverless wrappers. The core frontend Javascript maintains zero structural knowledge of the execution keys.

## Screenshots

*(Placeholder for application interface captures)*

| Application Dashboard | Infinite Carousel | Embedded Player |
| :---: | :---: | :---: |
| *(image placeholder)* | *(image placeholder)* | *(image placeholder)* |

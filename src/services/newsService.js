/**
 * src/services/newsService.js
 * Fetches crypto news from CryptoCompare API with in-memory caching
 */

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
let newsCache = { data: null, ts: 0 };

async function fetchCryptoNews() {
  if (newsCache.data && Date.now() - newsCache.ts < CACHE_TTL) {
    return newsCache.data;
  }

  try {
    const res = await fetch(
      'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest',
      { signal: AbortSignal.timeout(10000) }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    if (json.Data && json.Data.length) {
      const articles = json.Data.map(a => ({
        id: String(a.id),
        title: a.title || '',
        body: a.body || '',
        imageUrl: a.imageurl || '',
        url: a.url || '',
        source: a.source_info?.name || a.source || '',
        sourceImg: a.source_info?.img || '',
        categories: (a.categories || '').split('|').filter(Boolean),
        tags: (a.tags || '').split('|').filter(Boolean),
        publishedAt: (a.published_on || 0) * 1000
      }));

      newsCache = { data: articles, ts: Date.now() };
      return articles;
    }

    return newsCache.data || [];
  } catch (e) {
    console.error('CryptoCompare news fetch error:', e.message);
    return newsCache.data || [];
  }
}

module.exports = { fetchCryptoNews };

/**
 * src/services/newsService.js
 * Fetches crypto news from RSS feeds (CoinTelegraph + CoinDesk) via rss2json
 */

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
let newsCache = { data: null, ts: 0 };

const RSS_FEEDS = [
  'https://cointelegraph.com/rss',
  'https://www.coindesk.com/arc/outboundfeeds/rss/'
];

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchFeed(rssUrl) {
  try {
    const url = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const json = await res.json();
    if (json.status !== 'ok' || !json.items) return [];

    const sourceName = json.feed?.title?.replace(/\.com.*$/, '') || 'Crypto News';
    const sourceImg = json.feed?.image || '';

    return json.items.map(item => ({
      id: item.guid || item.link || '',
      title: item.title || '',
      body: stripHtml(item.description || item.content || ''),
      imageUrl: item.thumbnail || item.enclosure?.link || '',
      url: item.link || '',
      source: sourceName,
      sourceImg: sourceImg,
      categories: (item.categories || []).filter(Boolean),
      publishedAt: new Date(item.pubDate).getTime() || Date.now()
    }));
  } catch (e) {
    console.error(`RSS fetch error (${rssUrl}):`, e.message);
    return [];
  }
}

async function fetchCryptoNews() {
  if (newsCache.data && Date.now() - newsCache.ts < CACHE_TTL) {
    return newsCache.data;
  }

  try {
    const results = await Promise.allSettled(RSS_FEEDS.map(fetchFeed));
    let articles = [];

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.length) {
        articles = articles.concat(r.value);
      }
    }

    // Sort by date, newest first
    articles.sort((a, b) => b.publishedAt - a.publishedAt);

    if (articles.length) {
      newsCache = { data: articles, ts: Date.now() };
    }

    return articles.length ? articles : (newsCache.data || []);
  } catch (e) {
    console.error('News fetch error:', e.message);
    return newsCache.data || [];
  }
}

module.exports = { fetchCryptoNews };

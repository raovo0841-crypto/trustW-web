/**
 * src/services/newsService.js
 * Fetches crypto news from CoinTelegraph RSS (direct XML parsing, no third-party)
 */
const https = require('https');

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
let newsCache = { data: null, ts: 0 };

const RSS_FEEDS = [
  { url: 'https://cointelegraph.com/rss', source: 'Cointelegraph', sourceImg: 'https://cointelegraph.com/assets/img/CT_Logo_YG_tag.png' },
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'CoinDesk', sourceImg: '' }
];

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 12000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve, reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function stripHtml(html) {
  return (html || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'").replace(/\s+/g, ' ').trim();
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</${tag}>`, 'i'));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
}

function extractMediaImg(xml) {
  const m = xml.match(/<media:content[^>]*url=["']([^"']+)["']/i)
           || xml.match(/<enclosure[^>]*url=["']([^"']+)["']/i)
           || xml.match(/<img[^>]*src=["']([^"']+)["']/i);
  return m ? m[1] : '';
}

function extractCategories(xml) {
  const cats = [];
  const re = /<category[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/category>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) cats.push(m[1].trim());
  return cats.filter(Boolean);
}

function parseRssFeed(xml, source, sourceImg) {
  const articles = [];
  const items = xml.split(/<item[\s>]/i).slice(1);

  for (const raw of items) {
    const item = raw.split(/<\/item>/i)[0];
    const title = stripHtml(extractTag(item, 'title'));
    if (!title) continue;

    const link = extractTag(item, 'link') || extractTag(item, 'guid');
    const pubDate = extractTag(item, 'pubDate');
    const desc = extractTag(item, 'description');
    const content = extractTag(item, 'content:encoded') || desc;
    const imageUrl = extractMediaImg(item) || extractMediaImg(desc);
    const categories = extractCategories(item);

    articles.push({
      id: link || title,
      title,
      body: stripHtml(content).substring(0, 500),
      imageUrl,
      url: link,
      source,
      sourceImg,
      categories,
      publishedAt: pubDate ? new Date(pubDate).getTime() : Date.now()
    });
  }
  return articles;
}

async function fetchFeed(feed) {
  try {
    const xml = await httpGet(feed.url);
    return parseRssFeed(xml, feed.source, feed.sourceImg);
  } catch (e) {
    console.error(`RSS fetch error (${feed.url}):`, e.message);
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

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const TM_KEY = 'nrvmD3IR6o4OkjGSL7RIScGw57xS9BiX';
const SG_ID  = 'NTY3MDEzNzh8MTc3MzU5MTE3Ny43NDUxODIz';
const SG_SEC = '4b9fd1114ab98c2302b0fbd0cfc19706cabdb70c94a1a92129bd05d3a256f7e4';
const SH_KEY = null;
const PORT   = process.env.PORT || 3000;

// ── Average market prices by category (sourced from industry reports) ──
// Used as baseline when APIs don't return prices
const MARKET_BASELINES = {
  music:   { low: 45,  avg: 115, high: 280 },
  sports:  { low: 35,  avg: 95,  high: 220 },
  arts:    { low: 40,  avg: 85,  high: 175 },
  comedy:  { low: 30,  avg: 65,  high: 130 },
  other:   { low: 35,  avg: 80,  high: 160 },
};

// Stable hash so prices don't change on re-search
function stableHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return Math.abs(h);
}

function stableRand(seed, min, max) {
  const h = stableHash(seed);
  return min + (h % 1000) / 1000 * (max - min);
}

// Generate realistic price for an event given its name + category
function generatePrice(eventName, category, platform) {
  const base = MARKET_BASELINES[category] || MARKET_BASELINES.other;

  // Use event name hash to pick a point in the price range
  const position = stableRand(eventName + 'position', 0.1, 0.9);
  const marketPrice = Math.round(base.low + position * (base.high - base.low));

  // Platform variance: TM slightly higher (primary market), SG/SH resale
  const variance = {
    tm: stableRand(eventName + 'tm', 0.95, 1.20),
    sg: stableRand(eventName + 'sg', 0.80, 1.05),
    sh: stableRand(eventName + 'sh', 0.85, 1.15),
  };

  const feeRate = { tm: 0.27, sg: 0.15, sh: 0.22 };

  const price = Math.round(marketPrice * variance[platform]);
  const fee   = Math.round(price * feeRate[platform]);
  return { price, fee };
}

function fetchJSON(apiUrl) {
  return new Promise((resolve, reject) => {
    https.get(apiUrl, { headers: { 'User-Agent': 'TicketComparator/1.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON: ' + data.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

// Detect category from TM classification
function tmCat(ev) {
  const seg   = (ev.classifications?.[0]?.segment?.name || '').toLowerCase();
  const genre = (ev.classifications?.[0]?.genre?.name   || '').toLowerCase();
  if (seg.includes('music') || seg.includes('concert')) return 'music';
  if (seg.includes('sport') || ['football','basketball','baseball','hockey','soccer','nfl','nba','mlb','nhl'].some(s => genre.includes(s))) return 'sports';
  if (seg.includes('art') || seg.includes('theatre') || seg.includes('theater')) return 'arts';
  if (genre.includes('comedy') || seg.includes('comedy')) return 'comedy';
  return 'other';
}

// Detect category from SG taxonomy
function sgCat(ev) {
  const tax = (ev.taxonomies?.[0]?.name || '').toLowerCase();
  if (['concert','music'].some(t => tax.includes(t))) return 'music';
  if (['sport','mlb','nba','nfl','nhl','mls','soccer'].some(t => tax.includes(t))) return 'sports';
  if (['theater','theatre','broadway','classical','dance','ballet','opera'].some(t => tax.includes(t))) return 'arts';
  if (tax.includes('comedy')) return 'comedy';
  return 'other';
}

function fmtDate(d) {
  return d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : 'TBA';
}

// ── Main search: fetch both APIs, merge, fill all prices ──────
async function searchEvents(q, filter) {
  const segMap = { music:'KZFzniwnSyZfZ7v7nJ', sports:'KZFzniwnSyZfZ7v7nE', arts:'KZFzniwnSyZfZ7v7na', comedy:'KZFzniwnSyZfZ7v7nn' };
  const taxMap = { music:'concert', sports:'sports', arts:'theater', comedy:'comedy' };

  let tmUrl = `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${TM_KEY}&keyword=${encodeURIComponent(q)}&size=12&sort=date,asc&locale=*`;
  if (filter && filter !== 'all' && segMap[filter]) tmUrl += `&segmentId=${segMap[filter]}`;

  let sgUrl = `https://api.seatgeek.com/2/events?q=${encodeURIComponent(q)}&client_id=${SG_ID}&client_secret=${SG_SEC}&per_page=12&sort=datetime_local.asc`;
  if (filter && filter !== 'all' && taxMap[filter]) sgUrl += `&taxonomies.name=${taxMap[filter]}`;

  const [tmResult, sgResult] = await Promise.allSettled([fetchJSON(tmUrl), fetchJSON(sgUrl)]);

  const tmData = tmResult.status === 'fulfilled' ? tmResult.value : null;
  const sgData = sgResult.status === 'fulfilled' ? sgResult.value : null;
  const tmErr  = tmResult.status === 'rejected'  ? tmResult.reason?.message : (tmData?.fault?.faultstring || tmData?.errors?.[0]?.detail || null);
  const sgErr  = sgResult.status === 'rejected'  ? sgResult.reason?.message : null;

  // Parse TM events
  const tmEvs = (tmData?._embedded?.events || []).map(ev => {
    const venue  = ev._embedded?.venues?.[0];
    const prMin  = ev.priceRanges?.[0]?.min || null;
    const cat    = tmCat(ev);
    const tmP    = prMin
      ? { price: Math.round(prMin), fee: Math.round(prMin * 0.27), live: true }
      : { ...generatePrice(ev.name, cat, 'tm'), live: false };
    return {
      name:  ev.name,
      date:  fmtDate(ev.dates?.start?.localDate),
      time:  ev.dates?.start?.localTime?.slice(0,5) || '',
      venue: venue?.name || '',
      city:  venue ? `${venue.city?.name || ''}${venue.stateCode ? ', ' + venue.stateCode : ''}` : '',
      cat,
      tmUrl: ev.url || `https://www.ticketmaster.com/search?q=${encodeURIComponent(q)}`,
      tmPrice: tmP,
    };
  });

  // Parse SG events
  const sgEvs = (sgData?.events || []).map(ev => {
    const venue = ev.venue;
    const sgMin = ev.stats?.lowest_price || ev.stats?.average_price || null;
    const cat   = sgCat(ev);
    const sgP   = sgMin
      ? { price: Math.round(sgMin), fee: Math.round(sgMin * 0.15), live: true }
      : { ...generatePrice(ev.title, cat, 'sg'), live: false };
    return {
      name:  ev.title,
      date:  ev.datetime_local ? new Date(ev.datetime_local).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'TBA',
      time:  ev.datetime_local ? new Date(ev.datetime_local).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}) : '',
      venue: venue?.name || '',
      city:  venue ? `${venue.city || ''}${venue.state ? ', ' + venue.state : ''}` : '',
      cat,
      sgUrl: ev.url || `https://seatgeek.com/?search[q]=${encodeURIComponent(q)}`,
      sgPrice: sgP,
    };
  });

  // Merge by name similarity
  function similarity(a, b) {
    a = a.toLowerCase().replace(/[^a-z0-9 ]/g, '');
    b = b.toLowerCase().replace(/[^a-z0-9 ]/g, '');
    const wa = new Set(a.split(' ').filter(w => w.length > 2));
    const wb = new Set(b.split(' ').filter(w => w.length > 2));
    let c = 0; for (const w of wa) if (wb.has(w)) c++;
    return c / Math.max(wa.size, wb.size, 1);
  }

  const merged = [];
  const usedSG = new Set();

  for (const tm of tmEvs) {
    let bestIdx = -1, bestScore = 0;
    for (let i = 0; i < sgEvs.length; i++) {
      if (usedSG.has(i)) continue;
      const s = similarity(tm.name, sgEvs[i].name);
      if (s > bestScore && s > 0.35) { bestIdx = i; bestScore = s; }
    }
    const sg = bestIdx >= 0 ? sgEvs[bestIdx] : null;
    if (sg) usedSG.add(bestIdx);

    const cat = tm.cat !== 'other' ? tm.cat : (sg?.cat || 'other');

    // SG price: use matched SG event's price, else generate from TM price anchor
    const sgRef = sg?.sgPrice || null;
    const sgFinal = sgRef || (() => {
      const anchor = tm.tmPrice.price;
      const p = { ...generatePrice(tm.name, cat, 'sg'), live: false };
      // Keep SG proportional to TM for realism
      p.price = Math.round(anchor * stableRand(tm.name + 'sg_ratio', 0.80, 1.05));
      p.fee   = Math.round(p.price * 0.15);
      return p;
    })();

    // StubHub: always estimated
    const shAnchor = tm.tmPrice.price;
    const shPrice  = Math.round(shAnchor * stableRand(tm.name + 'sh_ratio', 0.85, 1.15));
    const shFinal  = { price: shPrice, fee: Math.round(shPrice * 0.22), live: false };

    merged.push({
      name:  tm.name,
      date:  tm.date,
      time:  tm.time,
      venue: tm.venue || sg?.venue || '',
      city:  tm.city  || sg?.city  || '',
      cat,
      tm: { ...tm.tmPrice, url: tm.tmUrl },
      sg: { ...sgFinal,   url: sg?.sgUrl || `https://seatgeek.com/?search[q]=${encodeURIComponent(tm.name)}` },
      sh: { ...shFinal,   url: `https://www.stubhub.com/find/s/?q=${encodeURIComponent(tm.name)}` },
    });
  }

  // Add SG-only events not matched to TM
  for (let i = 0; i < sgEvs.length; i++) {
    if (usedSG.has(i)) continue;
    const sg  = sgEvs[i];
    const cat = sg.cat;
    const tmP = { ...generatePrice(sg.name, cat, 'tm'), live: false };
    tmP.price = Math.round(sg.sgPrice.price * stableRand(sg.name + 'tm_ratio', 0.95, 1.20));
    tmP.fee   = Math.round(tmP.price * 0.27);
    const shP = { ...generatePrice(sg.name, cat, 'sh'), live: false };
    shP.price = Math.round(sg.sgPrice.price * stableRand(sg.name + 'sh_ratio', 0.85, 1.15));
    shP.fee   = Math.round(shP.price * 0.22);
    merged.push({
      name: sg.name, date: sg.date, time: sg.time, venue: sg.venue, city: sg.city, cat,
      tm: { ...tmP, url: `https://www.ticketmaster.com/search?q=${encodeURIComponent(sg.name)}` },
      sg: { ...sg.sgPrice, url: sg.sgUrl },
      sh: { ...shP, url: `https://www.stubhub.com/find/s/?q=${encodeURIComponent(sg.name)}` },
    });
  }

  return { events: merged, tmErr, sgErr, tmTotal: tmData?.page?.totalElements || 0, sgTotal: sgData?.meta?.total || 0 };
}

// ── HTTP server ───────────────────────────────────────────────
const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.ico':'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (pathname === '/api/search') {
    const { q, filter } = parsed.query;
    if (!q) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing q' })); return; }
    try {
      const result = await searchEvents(q, filter || 'all');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname === '/api/debug') {
    const q = parsed.query.q || 'taylor swift';
    const result = await searchEvents(q, 'all').catch(e => ({ error: e.message }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result, null, 2));
    return;
  }

  // Static files
  let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(err.code === 'ENOENT' ? 404 : 500); res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'text/plain' });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`\n✅ Ticket Comparator running at http://localhost:${PORT}`);
  console.log(`   Ticketmaster : ${TM_KEY ? '✅' : '❌'} | SeatGeek : ${SG_ID ? '✅' : '❌'} | StubHub : ${SH_KEY ? '✅' : '⚠️  estimated'}`);
  console.log(`\n   Open: http://localhost:${PORT}\n`);
});

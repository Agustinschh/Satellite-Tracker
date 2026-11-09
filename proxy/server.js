/**
 * Proxy / Caché Backend Opcional (Node.js HTTP nativo) — TP7 Satellite Tracker
 *
 * Propósito:
 * 1. Mantener las credenciales de Space-Track.org y N2YO fuera del bundle móvil.
 * 2. Cachear en memoria las respuestas de catálogos/TLE con TTL de 12 horas para
 *    reducir drásticamente el consumo de cuota de las APIs aguas arriba.
 *
 * Ejecución:
 *   N2YO_API_KEY=... SPACETRACK_IDENTITY=... SPACETRACK_PASSWORD=... npm run proxy
 */

const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 4000);
const N2YO_API_KEY = process.env.N2YO_API_KEY || '';
const SPACETRACK_IDENTITY = process.env.SPACETRACK_IDENTITY || '';
const SPACETRACK_PASSWORD = process.env.SPACETRACK_PASSWORD || '';
const CACHE_TTL_MS = 12 * 3600 * 1000;

const memoryCache = new Map();

function getCached(key) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    memoryCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key, data) {
  memoryCache.set(key, { data, timestamp: Date.now() });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  const parsedUrl = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = parsedUrl.pathname;

  try {
    // Healthcheck
    if (path === '/health') {
      return sendJson(res, 200, {
        status: 'ok',
        hasN2yoKey: Boolean(N2YO_API_KEY),
        hasSpaceTrackCreds: Boolean(SPACETRACK_IDENTITY && SPACETRACK_PASSWORD),
        cachedEntries: memoryCache.size,
      });
    }

    // N2YO TLE Proxy: /api/n2yo/tle/:noradId
    const tleMatch = path.match(/^\/api\/n2yo\/tle\/(\d+)$/);
    if (tleMatch) {
      if (!N2YO_API_KEY) {
        return sendJson(res, 503, { error: 'N2YO_API_KEY no configurada en el proxy' });
      }
      const noradId = tleMatch[1];
      const cacheKey = `n2yo_tle_${noradId}`;
      const cached = getCached(cacheKey);
      if (cached) return sendJson(res, 200, cached);

      const upstream = await fetch(
        `https://api.n2yo.com/rest/v1/satellite/tle/${noradId}&apiKey=${encodeURIComponent(
          N2YO_API_KEY
        )}`
      );
      const data = await upstream.json();
      setCached(cacheKey, data);
      return sendJson(res, 200, data);
    }

    // N2YO Positions Proxy: /api/n2yo/positions/:id/:lat/:lon/:alt/:seconds
    const posMatch = path.match(
      /^\/api\/n2yo\/positions\/(\d+)\/([-\d.]+)\/([-\d.]+)\/([-\d.]+)\/(\d+)$/
    );
    if (posMatch) {
      if (!N2YO_API_KEY) {
        return sendJson(res, 503, { error: 'N2YO_API_KEY no configurada en el proxy' });
      }
      const [, id, lat, lon, alt, sec] = posMatch;
      const upstream = await fetch(
        `https://api.n2yo.com/rest/v1/satellite/positions/${id}/${lat}/${lon}/${alt}/${sec}/&apiKey=${encodeURIComponent(
          N2YO_API_KEY
        )}`
      );
      const data = await upstream.json();
      return sendJson(res, 200, data);
    }

    // Space-Track GP Proxy by NORAD ID: /api/spacetrack/gp/:noradId
    const stMatch = path.match(/^\/api\/spacetrack\/gp\/(\d+)$/);
    if (stMatch) {
      if (!SPACETRACK_IDENTITY || !SPACETRACK_PASSWORD) {
        return sendJson(res, 503, {
          error: 'SPACETRACK_IDENTITY / SPACETRACK_PASSWORD no configurados en el proxy',
        });
      }
      const noradId = stMatch[1];
      const cacheKey = `st_gp_${noradId}`;
      const cached = getCached(cacheKey);
      if (cached) return sendJson(res, 200, cached);

      const upstream = await fetch('https://www.space-track.org/ajaxauth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          identity: SPACETRACK_IDENTITY,
          password: SPACETRACK_PASSWORD,
          query: `https://www.space-track.org/basicspacedata/query/class/gp/NORAD_CAT_ID/${noradId}/orderby/EPOCH%20desc/limit/1/format/json`,
        }).toString(),
      });
      const data = await upstream.json();
      setCached(cacheKey, data);
      return sendJson(res, 200, data);
    }

    return sendJson(res, 404, { error: 'Ruta no encontrada en proxy TP7' });
  } catch (err) {
    return sendJson(res, 500, {
      error: err instanceof Error ? err.message : 'Error interno en proxy',
    });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[TP7 Proxy] Escuchando en http://localhost:${PORT}`);
  });
}

module.exports = { server };


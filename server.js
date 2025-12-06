
// server.js — نسخة موحّدة: عرض التفاصيل + استخراج بورت السيرفر + إرسال إيميل
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// لو السيرفر وراء Proxy (NGINX/Cloudflare)، فعل ده علشان x-forwarded-* تشتغل صح
app.set('trust proxy', true);

// استقبال JSON/Forms لو هتبعت Payload من الفرونت
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================
   أخطاء غير ملتقطة
   ========================= */
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
});

/* =========================
   إعداد البريد — Gmail + App Password (SSL 465)
   ========================= */
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // SSL
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

transporter.verify((err) => {
  if (err) {
    console.error('❌ SMTP verify failed:', err.message);
  } else {
    console.log('✅ SMTP ready');
  }
});

/* =========================
   تهدئة الإرسال (اختياري)
   ========================= */
const throttleEnabled = String(process.env.EMAIL_THROTTLE_ENABLED || 'false').toLowerCase() === 'true';
const THROTTLE_MS = (parseInt(process.env.EMAIL_THROTTLE_MINUTES || '10', 10) || 10) * 60 * 1000;
const throttleMap = new Map();

function shouldSendForIp(ip) {
  if (!throttleEnabled) return true;
  const last = throttleMap.get(ip);
  const now = Date.now();
  if (!last || now - last > THROTTLE_MS) {
    throttleMap.set(ip, now);
    return true;
  }
  return false;
}

/* =========================
   أدوات مساعدة + استخراج تفاصيل الاتصال
   ========================= */
function normalizeIP(ip) {
  if (!ip) return '';
  ip = ip.replace('::ffff:', '').trim();
  if (ip.includes(',')) ip = ip.split(',')[0].trim();
  return ip;
}

// استخراج تفاصيل الاتصال (Client/Server)
function getVisitContext(req) {
  // Client IP (يدعم x-forwarded-for)
  const rawIP = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
  const clientIP = normalizeIP(rawIP);

  // Client Port (بورت العميل المؤقت، للعرض فقط)
  const clientPort = req.socket.remotePort;

  // Protocol: x-forwarded-proto > req.protocol > http
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http');

  // Host + Port من الهيدرز
  const hostHeader = req.headers.host || '';
  let host = hostHeader;
  let headerPort = null;
  if (hostHeader.includes(':')) {
    const [h, p] = hostHeader.split(':');
    host = h;
    headerPort = p;
  }

  // Server Port: x-forwarded-port > host:port > env PORT > default by proto
  const xfPort = req.headers['x-forwarded-port'] ? String(req.headers['x-forwarded-port']) : null;
  const envPort = process.env.PORT ? String(process.env.PORT) : null;
  const defaultPort = proto === 'https' ? '443' : '80';
  const serverPort = xfPort || headerPort || envPort || defaultPort;

  const path = req.originalUrl || req.url || '/';
  const referer = req.get('referer') || req.get('referrer') || 'unknown';
  const ua = req.get('user-agent') || 'Unknown';

  const fullUrl = `${proto}://${host}${(serverPort && serverPort !== '80' && serverPort !== '443') ? `:${serverPort}` : ''}${path}`;
  const time = new Date().toISOString();

  return { clientIP, clientPort, proto, host, serverPort, path, referer, ua, fullUrl, time };
}

// HTML escape
function escapeHTML(str) {
  if (str === null || str === undefined) return '-';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* =========================
   الحاجة الجاية من الباك إند (بدّلها بالمصدر الحقيقي)
   ========================= */
async function getBackendPayload(req) {
  // أمثلة — بدّلها بما يناسبك من DB/Service
  const utm = {
    source: req.query.utm_source || null,
    medium: req.query.utm_medium || null,
    campaign: req.query.utm_campaign || null,
    term: req.query.utm_term || null,
    content: req.query.utm_content || null,
  };

  return {
    message: 'زيارة جديدة للموقع',
    utm,
    userId: req.query.userId || req.body?.userId || null,
    sessionId: req.query.sessionId || req.body?.sessionId || null,
  };
}

/* =========================
   قالب الإيميل
   ========================= */
function composeEmailHtml(payload, ctx) {
  const prettyPayload = `<pre style="white-space:pre-wrap;background:#f6f8fa;border:1px solid #eee;padding:10px;border-radius:6px;">${escapeHTML(JSON.stringify(payload, null, 2))}</pre>`;
  const row = (label, value) =>
    `<tr><td style="border:1px solid #e5e7eb;padding:8px;background:#fafafa;width:180px;"><b>${escapeHTML(label)}</b></td><td style="border:1px solid #e5e7eb;padding:8px;">${escapeHTML(value ?? '-')}</td></tr>`;
  return `
    <h2 style="margin:0 0 8px 0;">زيارة جديدة للموقع</h2>
    <table style="border-collapse:collapse;width:100%;max-width:700px;">
      ${row('Full URL', ctx.fullUrl)}
      ${row('Protocol', ctx.proto)}
      ${row('Host', ctx.host)}
      ${row('Server Port', ctx.serverPort)}
      ${row('Path', ctx.path)}
      ${row('Referer', ctx.referer)}
      ${row('Client IP', ctx.clientIP)}
      ${row('Client Port', ctx.clientPort)}
      ${row('User-Agent', ctx.ua)}
      ${row('Time (UTC)', ctx.time)}
    </table>
    <h3 style="margin:16px 0 6px 0;">Payload من الباك إند</h3>
    ${prettyPayload}
  `;
}

/* =========================
   إرسال الإيميل
   ========================= */
async function sendVisitEmail({ payload, context }) {
  const mailOptions = {
    from: `"${process.env.APP_NAME || 'App'}" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_TO,
    subject: `زيارة جديدة: ${context.path} (${context.host}:${context.serverPort})`,
    text:
`زيارة جديدة

Full URL: ${context.fullUrl}
Protocol: ${context.proto}
Host: ${context.host}
Server Port: ${context.serverPort}
Path: ${context.path}
Referer: ${context.referer}
Client IP: ${context.clientIP}
Client Port: ${context.clientPort}
User-Agent: ${context.ua}
Time (UTC): ${context.time}

Payload:
${JSON.stringify(payload, null, 2)}
`,
    html: composeEmailHtml(payload, context),
  };
  const info = await transporter.sendMail(mailOptions);
  console.log('✅ Email sent:', info.messageId);
  return info;
}

/* =========================
   Middleware يرسل إيميل مع كل زيارة GET
   يستثني الستاتيك علشان يقلّل السبام
   ========================= */
const STATIC_EXT_REGEX = /\.(css|js|png|jpg|jpeg|svg|ico|gif|webp|pdf|map|woff2?|ttf|eot)$/i;

async function emailOnVisit(req, res, next) {
  if (req.method !== 'GET') return next();
  if (STATIC_EXT_REGEX.test(req.path)) return next();

  const context = getVisitContext(req);
  console.log(`[EMAIL-MW] visit ${context.fullUrl}`);

  let payload;
  try {
    payload = await getBackendPayload(req);
  } catch (e) {
    console.error('❌ Failed to get backend payload:', e.message);
    payload = { error: 'payload_unavailable' };
  }

  const ip = context.clientIP;
  const canSend = shouldSendForIp(ip);

  if (canSend) {
    console.log(`[EMAIL-MW] sending email for ${ip} -> ${context.fullUrl}`);
    setImmediate(async () => {
      try {
        await sendVisitEmail({ payload, context });
      } catch (err) {
        console.error('❌ Auto email failed:', err.message);
      }
    });
  } else {
    console.log(`⏱️ Throttled email for IP ${ip} (skip)`);
  }

  return next();
}

// ✅ شغّل الإرسال قبل static
app.use(emailOnVisit);

// بعد كده فعّل static
app.use(express.static('public'));

/* =========================
   الصفحة الرئيسية — تصميم العرض
   ========================= */
app.get('/', async (req, res) => {
  const ctx = getVisitContext(req);

  // الوقت عالي الدقة
  const hr = process.hrtime.bigint();
  const nanos = hr.toString();
  const now = new Date();

  // UA + Accept-Language + fingerprint
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const acceptLang = req.headers['accept-language'] || 'Unknown';
  const fingerprintSource = `${ctx.clientIP}\n${userAgent}\n${acceptLang}`;
  const fingerprintHash = crypto.createHash('sha256').update(fingerprintSource).digest('hex');

  // IP Geolocation (اختياري)
  let ipGeo = {
    city: null,
    region: null,
    country_name: null,
    latitude: null,
    longitude: null,
    org: null,
    message: null
  };
  const isLocal =
    ctx.clientIP === '127.0.0.1' ||
    ctx.clientIP === '::1' ||
    ctx.clientIP.startsWith('192.168.') ||
    ctx.clientIP.startsWith('10.') ||
    ctx.clientIP.startsWith('172.16.') ||
    ctx.clientIP.startsWith('172.17.') ||
    ctx.clientIP.startsWith('172.18.') ||
    ctx.clientIP.startsWith('172.19.') ||
    ctx.clientIP.startsWith('172.20.') ||
    ctx.clientIP.startsWith('172.21.') ||
    ctx.clientIP.startsWith('172.22.') ||
    ctx.clientIP.startsWith('172.23.') ||
    ctx.clientIP.startsWith('172.24.') ||
    ctx.clientIP.startsWith('172.25.') ||
    ctx.clientIP.startsWith('172.26.') ||
    ctx.clientIP.startsWith('172.27.') ||
    ctx.clientIP.startsWith('172.28.') ||
    ctx.clientIP.startsWith('172.29.') ||
    ctx.clientIP.startsWith('172.30.') ||
    ctx.clientIP.startsWith('172.31.');

  if (!isLocal && ctx.clientIP) {
    try {
      // ⚠️ Requires Node 18+ for built-in fetch. لو نسخة أقدم ضيف node-fetch
      const response = await fetch(`https://ipapi.co/${ctx.clientIP}/json/`, {
        headers: { 'User-Agent': 'port-checker-app' }
      });
      if (response.ok) {
        const data = await response.json();
        ipGeo.city = data.city || null;
        ipGeo.region = data.region || null;
        ipGeo.country_name = data.country_name || data.country || null;
        ipGeo.latitude = data.latitude || null;
        ipGeo.longitude = data.longitude || null;
        ipGeo.org = data.org || data.asn || null;
      } else {
        ipGeo.message = `IP API response: ${response.status}`;
      }
    } catch (e) {
      ipGeo.message = 'IP API fetch failed';
    }
  } else {
    ipGeo.message = 'Local/private IP detected; use browser Geolocation for coordinates.';
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html lang="ar">
<head>
  <meta charset="utf-8" />
  <title>تفاصيل اتصالك</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4QZ8JgG0uZsWc7v3YfQ9fGq2V1rCwEoVtGZ7Z2J0wM=" crossorigin="anonymous">
  <style>
    :root { --bg:#0f172a; --card:#111827; --text:#e5e7eb; --muted:#9ca3af; --accent:#22d3ee; }
    body { margin:0; font-family: system-ui, Arial; background: var(--bg); color: var(--text); }
    .wrap { max-width: 960px; margin: 40px auto; padding: 0 16px; }
    .card { background: var(--card); border-radius: 16px; padding: 24px; box-shadow: 0 8px 24px rgba(0,0,0,.35); }
    h1 { margin-top:0; font-size: 24px; }
    .grid { display:grid; grid-template-columns: repeat(auto-fit,minmax(240px,1fr)); gap: 12px; }
    .item { background: rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 14px; }
    .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .val { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size:14px; word-break: break-all; }
    .hr { border:0; border-top:1px solid rgba(255,255,255,.08); margin: 16px 0; }
    .hint { color: var(--muted); font-size: 13px; }
    .badge { display:inline-block; padding:2px 8px; border-radius:999px; background: rgba(34,211,238,.15); color: var(--accent); font-size:12px; }
    .map { height: 320px; border-radius: 12px; overflow: hidden; border:1px solid rgba(255,255,255,.12); }
    .btn { background: var(--accent); color:#0b1020; border:0; padding:10px 14px; border-radius:10px; font-weight:600; cursor:pointer; }
    .btn:disabled { opacity:.6; cursor:not-allowed; }
    a { color: var(--accent); text-decoration:none; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>تفاصيل اتصالك <span class="badge">Live</span></h1>
      <div class="grid">
        <div class="item"><div class="label">Client IP</div><div class="val">${ctx.clientIP || 'غير متاح'}</div></div>
        <div class="item"><div class="label">Client Port</div><div class="val">${ctx.clientPort}</div></div>
        <div class="item"><div class="label">Server Host</div><div class="val">${escapeHTML(ctx.host)}</div></div>
        <div class="item"><div class="label">Server Port</div><div class="val">${ctx.serverPort}</div></div>
        <div class="item"><div class="label">Protocol</div><div class="val">${ctx.proto}</div></div>
        <div class="item"><div class="label">Full URL</div><div class="val">${escapeHTML(ctx.fullUrl)}</div></div>
        <div class="item"><div class="label">Server Time (ISO)</div><div class="val">${now.toISOString()}</div></div>
        <div class="item"><div class="label">High-Res (nanos)</div><div class="val">${nanos} ns</div></div>
        <div class="item"><div class="label">User-Agent</div><div class="val">${escapeHTML(userAgent)}</div></div>
        <div class="item"><div class="label">Accept-Language</div><div class="val">${escapeHTML(acceptLang)}</div></div>
        <div class="item"><div class="label">Fingerprint (SHA-256)</div><div class="val">${fingerprintHash}</div></div>
      </div>
      <hr class="hr"/>
      <h2>الموقع والإحداثيات</h2>
      <p class="hint">* لو الـ IP محلي، استخدم زر "الحصول على إحداثياتي" (Geolocation) للحصول على إحداثيات دقيقة من المتصفح.</p>
      <div class="grid">
        <div class="item"><div class="label">City</div><div class="val" id="city">${ipGeo.city ?? '-'}</div></div>
        <div class="item"><div class="label">Region</div><div class="val" id="region">${ipGeo.region ?? '-'}</div></div>
        <div class="item"><div class="label">Country</div><div class="val" id="country">${ipGeo.country_name ?? '-'}</div></div>
        <div class="item"><div class="label">ISP/Org</div><div class="val" id="org">${ipGeo.org ?? '-'}</div></div>
        <div class="item"><div class="label">Latitude</div><div class="val" id="lat">${ipGeo.latitude ?? '-'}</div></div>
        <div class="item"><div class="label">Longitude</div><div class="val" id="lon">${ipGeo.longitude ?? '-'}</div></div>
      </div>
      <p class="hint">${ipGeo.message ? escapeHTML(ipGeo.message) : ''}</p>
      <div style="margin:14px 0;">
        <button class="btn" id="geoBtn">الحصول على إحداثياتي (المتصفح)</button>
      </div>
      <div id="map" class="map"></div>
      <p class="hint">نصيحة: عند النشر على الإنترنت (IP عام)، تظهر بيانات IP Geolocation تلقائيًا. على localhost استخدم Geolocation.</p>
    </div>
  </div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-VzLQY3TqVnP+9cYkq4ZfJrWGZcC9ZL4D2t3f9Z8zQlw=" crossorigin="anonymous"></script>
  <script type="module">
    import CryptoJS from "https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/+esm";
    function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
    let map;
    function initMap(lat, lon) {
      if (!map) {
        map = L.map('map').setView([lat, lon], 13);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors'
        }).addTo(map);
        L.marker([lat, lon]).addTo(map);
      } else {
        map.setView([lat, lon], 13);
        L.marker([lat, lon]).addTo(map);
      }
    }
    const btn = document.getElementById('geoBtn');
    btn?.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'جاري الحصول على الإحداثيات...';
      if (!navigator.geolocation) {
        alert('المتصفح لا يدعم Geolocation');
        btn.disabled = false; btn.textContent = 'الحصول على إحداثياتي (المتصفح)';
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setText('lat', latitude.toFixed(6));
          setText('lon', longitude.toFixed(6));
          initMap(latitude, longitude);
          btn.textContent = 'تم الحصول على الإحداثيات ✔';
        },
        (err) => {
          alert('تعذر الحصول على الإحداثيات: ' + err.message);
          btn.disabled = false; btn.textContent = 'الحصول على إحداثياتي (المتصفح)';
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
    const clientFPSource = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
      Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    ].join('\n');
    const clientFPHash = CryptoJS.SHA256(clientFPSource).toString();
    console.log('Client fingerprint (SHA-256):', clientFPHash);
    const latEl = document.getElementById('lat'); const lonEl = document.getElementById('lon');
    const lat = parseFloat(latEl.textContent); const lon = parseFloat(lonEl.textContent);
    if (!isNaN(lat) && !isNaN(lon)) { initMap(lat, lon); }
  </script>
</body>
</html>`);
});

/* =========================
   مسtest' };
    await sendVisitEmail({ payload, context });
    res.send('✅ تم إرسال إيميل الاختبار');
  } catch (e) {
    res.status(500).send('❌ فشل إرسال إيميل الاختبار: ' + e.message);
  }
});

/* =========================
   تشغيل الخادم
   ========================= */
app.listen(PORT, () => {
  console.log(`✅ API running at http://localhost:${PORT}`);
});

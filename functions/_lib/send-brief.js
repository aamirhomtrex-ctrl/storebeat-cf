// Netlify Function: emails the manager's approved Storebeat actions to THEIR OWN address.
// It never emails suppliers or customers: the manager sends those drafts themselves (copy, email or WhatsApp buttons).
// Environment variables: BREVO_API_KEY, SENDER_EMAIL (verified in Brevo), optional SENDER_NAME, ALLOWED_ORIGIN.

const hits = new Map();
const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
const reply = (code, obj, origin) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin || '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: JSON.stringify(obj) });
function build(b) {
  const cur = clip(b.currency || 'AED', 4).replace(/[^A-Za-z]/g, '') || 'AED';
  const issues = (Array.isArray(b.issues) ? b.issues : []).slice(0, 10).map(i => ({ store: clip(i.store, 60), title: clip(i.title, 140), risk: Math.max(0, Math.round(Number(i.at_risk) || 0)), sev: i.severity === 'high' ? 'Urgent' : 'Watch' }));
  const actions = (Array.isArray(b.actions) ? b.actions : []).slice(0, 12).map(a => ({ label: clip(a.label, 120), to: clip(a.to, 120), subject: clip(a.subject, 160), body: clip(a.body, 1800) }));
  const head = clip(b.headline, 200), demo = !!b.demo;
  const text = ['Storebeat brief for ' + clip(b.date, 20) + (demo ? ' (DEMO DATA)' : ''), head, '', 'Issues found:', ...issues.map(i => `- [${i.sev}] ${i.title}${i.risk ? ` (${cur} ${i.risk} at risk)` : ''}`), '', 'Approved actions (send these yourself):', ...actions.map((a, n) => `\n${n + 1}. ${a.label}\nTo: ${a.to}\nSubject: ${a.subject}\n\n${a.body}`)].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#16202c"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #d9dee5;border-radius:10px"><tr><td style="padding:20px 24px;background:#1f4fd8;color:#fff;border-radius:10px 10px 0 0"><div style="font-size:20px;font-weight:700">Storebeat</div><div style="font-size:14px">Brief for ${esc(clip(b.date, 20))}${demo ? ' (demo data)' : ''}</div></td></tr><tr><td style="padding:20px 24px"><p style="margin:0 0 14px;font-size:16px"><strong>${esc(head)}</strong></p><p style="margin:0 0 6px;font-size:14px;color:#566474">Issues found</p><ul style="margin:0 0 18px;padding-left:18px;font-size:15px">${issues.map(i => `<li><strong>${esc(i.sev)}:</strong> ${esc(i.title)}${i.risk ? ` (${esc(cur)} ${i.risk} at risk)` : ''}</li>`).join('')}</ul><p style="margin:0 0 6px;font-size:14px;color:#566474">Approved actions. You send these yourself.</p>${actions.map((a, n) => `<div style="border:1px solid #d9dee5;border-radius:8px;padding:12px;margin:0 0 12px"><div style="font-weight:700">${n + 1}. ${esc(a.label)}</div><div style="font-size:13px;color:#566474">To: ${esc(a.to)} | Subject: ${esc(a.subject)}</div><pre style="white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:14px;margin:8px 0 0">${esc(a.body)}</pre></div>`).join('')}<p style="margin:14px 0 0;font-size:12px;color:#566474">Storebeat suggests actions from the numbers you gave it. A person approves and sends every action.</p></td></tr></table></td></tr></table></body></html>`;
  return { text, html, subject: `Storebeat brief${demo ? ' (demo)' : ''}: ${clip(b.date, 20)}`, count: actions.length, rows: actions.map(a => ({ time: new Date().toISOString(), mode: demo ? 'demo' : 'live', action: a.label, subject: a.subject.slice(0, 120), approved_by: '', result: 'in approved brief emailed to manager' })) };
}


// Optional audit log: one row per approved action goes to a PRIVATE Google Sheet through an Apps Script web app.
// Env: SHEET_WEBHOOK_URL (the web app URL) and SHEET_WEBHOOK_SECRET (must match the script). Logs no email addresses and no message text.
async function logRows(rows) {
  const url = process.env.SHEET_WEBHOOK_URL;
  if (!url || !rows.length) return null;
  try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret: process.env.SHEET_WEBHOOK_SECRET || '', rows }), signal: ctl.signal });
    clearTimeout(timer);
    return r.ok;
  } catch (e) { console.error('sheet log failed', e && e.message); return false; }
}

// "Send now": one approved draft, sent by the manager's click. One recipient only. Replies go to the manager (Reply-To).
// In demo mode the recipient is forced to the manager's own address, so made-up supplier addresses are never emailed.
const mailOk = e => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(e) && e.length <= 200;
async function sendOne(s, ip, limited, origin) {
  const replyTo = clip(s.replyTo, 200).trim(), demo = !!s.demo;
  const to = demo ? replyTo : clip(s.to, 200).trim();
  if (!mailOk(replyTo)) return reply(400, { ok: false, error: 'Your own email is needed so replies come to you' }, origin);
  if (!mailOk(to)) return reply(400, { ok: false, error: 'A valid recipient email is needed' }, origin);
  const subject = clip(s.subject, 160).replace(/[\r\n]+/g, ' ').trim(), text = clip(s.body, 3000).trim();
  if (!subject || !text) return reply(400, { ok: false, error: 'Subject and text are needed' }, origin);
  if (text.indexOf('[Your name]') > -1) return reply(400, { ok: false, error: 'Replace [Your name] with your name first' }, origin);
  if (limited('send|' + ip, 12)) return reply(429, { ok: false, error: 'Too many emails sent from this connection. Try again later.' }, origin);
  if (!process.env.BREVO_API_KEY || !process.env.SENDER_EMAIL) return reply(500, { ok: false, error: 'Email service is not configured' }, origin);
  const name = clip(s.senderName, 60).replace(/[^\p{L}\p{N} .'-]/gu, '').trim();
  const foot = (demo ? 'DEMO: this is a test email made from demo data. It went only to the person who pressed Send now.\n\n' : '') + '--\nSent with Storebeat on behalf of ' + (name || replyTo) + '. Reply to this email to reach them directly.';
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#16202c"><pre style="white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:15px;margin:0 0 16px">' + esc(text) + '</pre><p style="font-size:12px;color:#566474;border-top:1px solid #d9dee5;padding-top:10px;white-space:pre-wrap">' + esc(foot) + '</p></div>';
  const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ sender: { name: (name ? name + ' via ' : '') + (process.env.SENDER_NAME || 'Storebeat'), email: process.env.SENDER_EMAIL }, to: [{ email: to }], replyTo: { email: replyTo }, subject: (demo ? '[DEMO] ' : '') + subject, htmlContent: html, textContent: text + '\n\n' + foot }) });
  if (!r.ok) return reply(502, { ok: false, error: 'Email provider replied ' + r.status }, origin);
  const logged = await logRows([{ time: new Date().toISOString(), mode: demo ? 'demo' : 'live', action: 'Send now', subject: subject.slice(0, 120), approved_by: name || '', result: 'sent' }]);
  return reply(200, { ok: true, to, logged: logged === null ? undefined : logged }, origin);
}
exports.handler = async (event) => {
  const origin = process.env.ALLOWED_ORIGIN || '*';
  if (event.httpMethod === 'OPTIONS') return reply(204, {}, origin);
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'Use POST' }, origin);
  const ro = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  if (process.env.ALLOWED_ORIGIN && ro && ro !== process.env.ALLOWED_ORIGIN) return reply(403, { ok: false, error: 'Origin not allowed' }, origin);
  const ip = (event.headers && (event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'])) || 'unknown';
  const limited = (key, max) => { const now = Date.now(), arr = (hits.get(key) || []).filter(t => now - t < 3600e3); if (arr.length >= max) return true; arr.push(now); hits.set(key, arr); return false; };
  let raw = event.body || ''; if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (raw.length > 60000) return reply(413, { ok: false, error: 'Too large' }, origin);
  let body; try { body = JSON.parse(raw); } catch (e) { return reply(400, { ok: false, error: 'Bad JSON' }, origin); }
  if (body.source === 'store-pulse' && body.send && typeof body.send === 'object') return sendOne(body.send, ip, limited, origin);
  if (limited(ip, 5)) return reply(429, { ok: false, error: 'Too many requests' }, origin);
  if (body.source !== 'store-pulse' || !body.brief || typeof body.brief !== 'object') return reply(400, { ok: false, error: 'Unexpected payload' }, origin);
  const email = clip(body.recipient && body.recipient.email, 200).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { ok: false, error: 'A valid email is required' }, origin);
  const m = build(body.brief);
  if (!m.count) return reply(400, { ok: false, error: 'No approved actions' }, origin);
  if (!process.env.BREVO_API_KEY || !process.env.SENDER_EMAIL) return reply(500, { ok: false, error: 'Email service is not configured' }, origin);
  const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ sender: { name: process.env.SENDER_NAME || 'Storebeat', email: process.env.SENDER_EMAIL }, to: [{ email }], subject: m.subject, htmlContent: m.html, textContent: m.text }) });
  if (!r.ok) return reply(502, { ok: false, error: 'Email provider replied ' + r.status }, origin);
  const logged = await logRows(m.rows);
  return reply(200, { ok: true, logged: logged === null ? undefined : logged }, origin);
};

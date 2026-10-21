let role = 'scan';
const $ = id => document.getElementById(id);
try { $('device').value = localStorage.getItem('sp_device') || ''; } catch (_) {}
document.querySelectorAll('#seg button').forEach(b => b.onclick = () => {
  role = b.dataset.role;
  document.querySelectorAll('#seg button').forEach(x => x.classList.toggle('active', x === b));
  $('secretLabel').textContent = role === 'admin' ? 'Passwort' : 'PIN';
  $('devWrap').classList.toggle('hidden', role === 'admin');
});
fetch('/api/me').then(r => r.json()).then(m => {
  if (m.role === 'admin') location.href = '/admin';
  else if (m.role === 'scan') location.href = '/scan';
});
$('f').onsubmit = async e => {
  e.preventDefault();
  $('err').classList.add('hidden');
  const device = $('device').value.trim();
  try { localStorage.setItem('sp_device', device); } catch (_) {}
  const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, secret: $('secret').value, device }) });
  const d = await r.json();
  if (!r.ok) { $('err').textContent = d.error || 'Anmeldung fehlgeschlagen.'; $('err').classList.remove('hidden'); return; }
  location.href = role === 'admin' ? '/admin' : '/scan';
};

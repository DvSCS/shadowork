let loginPromise;
const dialog = document.createElement('dialog'); dialog.id = 'cloud-login';
dialog.innerHTML = `<form id="cloud-login-form"><div class="panel-heading"><div><span class="eyebrow mint">SEU ESPAÇO DE ESTUDO</span><h2>Entrar no SceneLingo</h2></div></div><p class="muted">Use a chave de administração que você definiu ao configurar sua instalação.</p><label class="field-label" for="cloud-password">CHAVE DE ADMINISTRAÇÃO</label><input id="cloud-password" type="password" autocomplete="current-password" required maxlength="1024"><p id="cloud-login-error" class="error" role="alert"></p><button id="cloud-login-submit" type="submit" class="button primary full">Entrar</button></form>`;
document.body.append(dialog);
dialog.addEventListener('cancel', event => event.preventDefault());
const banner = document.createElement('div'); banner.id = 'cloud-banner'; banner.className = 'inline-note cloud-banner'; banner.hidden = true; document.querySelector('.topbar').after(banner);
const logout = document.createElement('button'); logout.id = 'cloud-logout'; logout.className = 'button ghost compact'; logout.textContent = 'Sair'; logout.hidden = true; document.querySelector('.topbar').append(logout);
logout.onclick = async () => { await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); location.reload(); };
export function requestLogin() {
  if (loginPromise) return loginPromise;
  loginPromise = new Promise(resolve => {
    dialog.showModal();
    dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault(); const button = document.querySelector('#cloud-login-submit'), input = document.querySelector('#cloud-password'); button.disabled = true;
      try {
        const response = await fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: input.value }) });
        const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Não foi possível entrar.');
        input.value = ''; document.querySelector('#cloud-login-error').textContent = ''; dialog.close(); logout.hidden = false; loginPromise = null; resolve();
      } catch (error) { document.querySelector('#cloud-login-error').textContent = error.message; }
      finally { button.disabled = false; }
    };
  });
  return loginPromise;
}
export async function cloudFetch(url, options) {
  let response = await fetch(url, { ...options, credentials: 'same-origin' });
  if (response.status === 401) { await requestLogin(); response = await fetch(url, { ...options, credentials: 'same-origin' }); }
  return response;
}
export function showCloudState(value) {
  banner.hidden = !value.readOnly;
  banner.textContent = value.readOnly ? 'Modo demonstração: ajustes temporários. Para criar sessões permanentes, configure a chave de administração e o banco Redis da sua instalação.' : '';
  document.querySelector('.beta').textContent = value.readOnly ? 'v1.1 · demonstração' : 'v1.1 · nuvem';
  document.querySelector('.local-status').textContent = 'Vídeos e gravações ficam neste dispositivo';
  logout.hidden = !value.authenticated;
}

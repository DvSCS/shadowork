document.getElementById('activate').addEventListener('click', async () => {
  const button = document.getElementById('activate'), status = document.getElementById('status'); button.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/.test(tab.url || '')) throw new Error('Abra uma página HTTP/HTTPS com seu player antes de ativar.');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    status.textContent = 'Painel ativado. Carregue sua sessão JSON no player.';
  } catch (error) { status.textContent = error.message || 'Não foi possível ativar nesta página.'; }
  finally { button.disabled = false; }
});

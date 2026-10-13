(() => {
  'use strict';
  const config = window.ALEXT_AI_CONFIG;
  if (!config || config.enabled !== true || config.endpoint !== 'https://ai.alext.io' || typeof config.siteKey !== 'string' || document.querySelector('alext-assistant')) return;
  const host = document.createElement('alext-assistant');
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = /* CSS_INJECT */ ''; root.append(style);
  function el(tag, attributes = {}, text = '') {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    if (text) node.textContent = text;
    return node;
  }
  const launcher = el('button', { class: 'launcher', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'alext-ai-dialog' });
  launcher.append(el('span', { class: 'mark', 'aria-hidden': 'true' }, 'AI'), document.createTextNode('Ask about Alex'));
  const dialog = el('dialog', { id: 'alext-ai-dialog', class: 'panel', 'aria-labelledby': 'alext-ai-title', 'aria-describedby': 'alext-ai-subtitle' });
  const header = el('header', { class: 'header' }); const title = el('div');
  title.append(el('h2', { id: 'alext-ai-title' }, 'Alex, through his work'), el('p', { id: 'alext-ai-subtitle', class: 'subtitle' }, 'AI portfolio assistant. Not Alex personally.'));
  const close = el('button', { type: 'button', 'aria-label': 'Close assistant' }, '\u00d7'); header.append(title, close);
  const body = el('div', { class: 'body' });
  body.append(el('p', { class: 'intro' }, 'Explore Alex\'s documented experience, or discuss how he might approach your team\'s engineering problem. I distinguish evidence from suggestions.'));
  const starters = el('div', { class: 'starters', 'aria-label': 'Suggested questions' });
  for (const prompt of ['Why should we hire Alex?', 'Show me his engineering projects.', 'How could Alex accelerate AI adoption on our team?', 'Tell me about his cloud and full-stack experience.']) {
    const button = el('button', { type: 'button' }, prompt); button.addEventListener('click', () => { question.value = prompt; question.focus(); }); starters.append(button);
  }
  const log = el('div', { role: 'log', 'aria-label': 'Conversation', 'aria-live': 'off' }); body.append(starters, log);
  const form = el('form', { class: 'composer' });
  const modeRow = el('div', { class: 'mode-row' }); const mode = el('select', { id: 'alext-ai-mode' });
  for (const [value, label] of [['recruiter', 'Recruiter'], ['hiring-manager', 'Hiring manager'], ['leadership', 'Engineering leadership']]) mode.append(el('option', { value }, label));
  modeRow.append(el('label', { for: 'alext-ai-mode' }, 'Answer for'), mode);
  const question = el('textarea', { id: 'alext-ai-question', rows: '2', maxlength: '2000', required: '', placeholder: 'What does your team need to build?', 'aria-describedby': 'alext-ai-status' });
  const privacy = el('details', { class: 'privacy' }); privacy.append(el('summary', {}, 'Privacy and local AI'));
  privacy.append(el('p', {}, 'Messages go through Cloudflare to an Ollama model on Alex\'s Mac mini. Cloudflare terminates HTTPS. The assistant does not persist chat logs. Server context expires after 15 minutes and is purged within 15 seconds under normal operation; visible messages remain in this tab until restarted or closed. Provider logs and existing website analytics have separate settings. Do not enter confidential information.'));
  const consentLabel = el('label', { class: 'consent' }); const consent = el('input', { type: 'checkbox', id: 'alext-ai-consent' });
  consentLabel.append(consent, document.createTextNode('I understand and agree to send my question for local AI processing and human verification.')); privacy.append(consentLabel); privacy.open = true;
  const challenge = el('div', { class: 'challenge' });
  const actions = el('div', { class: 'actions' });
  const restart = el('button', { type: 'button' }, 'Restart'); const stop = el('button', { type: 'button', hidden: '' }, 'Stop'); const send = el('button', { class: 'send', type: 'submit' }, 'Send'); actions.append(restart, stop, send);
  const status = el('p', { id: 'alext-ai-status', class: 'status', role: 'status', 'aria-live': 'polite' });
  const links = el('div', { class: 'links' });
  links.append(el('a', { href: 'mailto:alex@alext.io?subject=Engineering%20opportunity' }, 'Email Alex'), el('a', { href: 'https://github.com/StarShows/', target: '_blank', rel: 'noopener noreferrer' }, 'View GitHub'));
  form.append(modeRow, el('label', { class: 'question-label', for: 'alext-ai-question' }, 'Your question'), question, privacy, challenge, actions, status, links);
  dialog.append(header, body, form); root.append(launcher, dialog); document.body.append(host);
  let session = null; let controller = null; let sending = false; let scriptPromise = null;
  function announce(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
  function scrollToReply() { body.scrollTop = body.scrollHeight; }
  function openDialog() { dialog.showModal(); launcher.setAttribute('aria-expanded', 'true'); question.focus(); }
  function closeDialog() { controller?.abort(); dialog.close(); launcher.setAttribute('aria-expanded', 'false'); launcher.focus(); }
  launcher.addEventListener('click', openDialog); close.addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
  stop.addEventListener('click', () => controller?.abort());
  function setSending(value) {
    sending = value; send.disabled = value; mode.disabled = value; stop.hidden = !value;
    log.setAttribute('aria-busy', String(value));
    if (!value && root.activeElement === stop) question.focus();
  }
  const sourceOrigins = new Set(['https://alext.io', 'https://github.com', 'https://www.realtor-studio.com', 'https://www.justgetcreamed.com', 'https://www.choptsalad.com']);
  function safeLink(value) {
    try { const url = new URL(value); return sourceOrigins.has(url.origin) && !url.username && !url.password && !url.search && !/[%\\]/.test(url.pathname) && (url.hostname !== 'github.com' || /^\/StarShows(?:\/|$)/.test(url.pathname)); } catch { return false; }
  }
  function inline(parent, text) {
    // Restricted Markdown only: bold and inline code. HTML, images and generated links stay inert text.
    for (const piece of text.split(/(\*\*[^*\n]{1,200}\*\*|`[^`\n]{1,200}`)/g)) {
      if (piece.startsWith('**') && piece.endsWith('**')) parent.append(el('strong', {}, piece.slice(2, -2)));
      else if (piece.startsWith('`') && piece.endsWith('`')) parent.append(el('code', {}, piece.slice(1, -1)));
      else parent.append(document.createTextNode(piece));
    }
  }
  function markdown(parent, text) {
    for (const paragraph of text.split(/\n\s*\n/)) {
      const lines = paragraph.split('\n');
      if (lines.every((line) => line.startsWith('- '))) { const list = el('ul'); for (const line of lines) { const item = el('li'); inline(item, line.slice(2)); list.append(item); } parent.append(list); }
      else { const item = el('p'); inline(item, paragraph); parent.append(item); }
    }
  }
  function validBlock(block) {
    return block && /^b[0-3]$/.test(block.id) && ['evidence', 'approach', 'notice'].includes(block.kind) && typeof block.text === 'string' && block.text.length <= 2400 && Array.isArray(block.citations) && block.citations.length <= 3 && block.citations.every((source) => source && typeof source.id === 'string' && typeof source.label === 'string' && source.label.length <= 80 && typeof source.url === 'string' && source.url.length <= 300 && safeLink(source.url));
  }
  function addMessage(who, text = '') {
    const article = el('article', { class: `message ${who}`, 'aria-label': who === 'user' ? 'Your message' : 'Assistant response' });
    article.append(el('span', { class: 'speaker' }, who === 'user' ? 'You' : 'Alex\'s AI assistant'));
    if (text) article.append(el('p', {}, text)); log.append(article);
    while (log.children.length > 40) log.firstElementChild.remove(); scrollToReply(); return article;
  }
  function addBlock(article, block) {
    const section = el('section', { class: `block ${block.kind}` });
    section.append(el('span', { class: 'block-label' }, block.kind === 'evidence' ? 'DOCUMENTED EXPERIENCE' : block.kind === 'approach' ? 'SUGGESTED APPROACH, NOT A CLAIM OF PRIOR DELIVERY' : 'CONTEXT'));
    markdown(section, block.text);
    if (block.citations.length) { const references = el('nav', { class: 'references', 'aria-label': 'Supporting sources' }); for (const source of block.citations) references.append(el('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer' }, source.label)); section.append(references); }
    article.append(section); scrollToReply();
  }
  function loadHumanCheck() {
    if (window.turnstile) return Promise.resolve();
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise((resolve, reject) => {
      const script = el('script', { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', async: '', defer: '' });
      script.onload = () => window.turnstile ? resolve() : reject(new Error('Human verification could not load.'));
      script.onerror = () => { script.remove(); scriptPromise = null; reject(new Error('Human verification is unavailable. Try again or contact Alex directly.')); };
      document.head.append(script);
    });
    return scriptPromise;
  }
  async function humanToken(signal) {
    await Promise.race([loadHumanCheck(), new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true }))]);
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      let id; let settled = false;
      function finish(error, token) {
        if (settled) return; settled = true; signal.removeEventListener('abort', abort);
        queueMicrotask(() => { if (id !== undefined) window.turnstile.remove(id); });
        error ? reject(error) : resolve(token);
      }
      const abort = () => finish(new DOMException('Stopped', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      try { id = window.turnstile.render(challenge, { sitekey: config.siteKey, action: 'portfolio_session', theme: 'dark', size: 'flexible', callback: (token) => finish(null, token), 'error-callback': () => finish(new Error('Human verification failed. Please try again.')), 'expired-callback': () => finish(new Error('Verification expired. Please try again.')), 'timeout-callback': () => finish(new Error('Verification timed out. Please try again.')) }); }
      catch { finish(new Error('Human verification is unavailable.')); }
    });
  }
  async function errorText(response) {
    // Do not render arbitrary server/proxy error pages or exception details.
    if (response.status === 401) { session = null; return 'This session expired. Send again to start a new verified conversation.'; }
    if (response.status === 429) return 'The assistant has reached a temporary request limit. Please pause before trying again.';
    if (response.status === 400 || response.status === 413) return 'Please shorten your question and try again.';
    if (response.status === 403) return 'Human verification was not accepted. Please restart and try again.';
    return 'The local assistant is temporarily unavailable. You can still explore GitHub or email Alex below.';
  }
  async function ensureSession(signal) {
    if (session && session.expiresAt > Date.now() + 5000) return session.token;
    announce('Completing human verification...');
    const token = await humanToken(signal);
    const response = await fetch(`${config.endpoint}/v1/session`, { method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turnstileToken: token, consent: true }), signal });
    if (!response.ok) throw new Error(await errorText(response));
    const result = await response.json();
    if (!/^[A-Za-z0-9_-]{43}$/.test(result.token) || !Number.isSafeInteger(result.expiresAt)) throw new Error('The session could not be verified.');
    session = result; privacy.open = false; return result.token;
  }
  async function readStream(response, onEvent, signal) {
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('The assistant returned an incomplete response.');
    const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true }); let pending = ''; let total = 0;
    try {
      while (true) {
        signal.throwIfAborted(); const item = await reader.read(); if (item.done) break;
        total += item.value.length; if (total > 131072) throw new Error('The assistant response exceeded its limit.');
        pending += decoder.decode(item.value, { stream: true });
        let boundary;
        while ((boundary = pending.indexOf('\n\n')) >= 0) {
          const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
          if (frame.length > 20000) throw new Error('Invalid response frame.');
          const name = frame.split('\n').find((line) => line.startsWith('event: '))?.slice(7);
          const data = frame.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n');
          if (name && data) onEvent(name, JSON.parse(data));
        }
        if (pending.length > 20000) throw new Error('Invalid response frame.');
      }
      pending += decoder.decode(); if (pending.trim()) throw new Error('The response ended early.');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (sending) return;
    if (!consent.checked) { privacy.open = true; announce('Please review the privacy note and check the consent box first.', true); consent.focus(); return; }
    const text = question.value.trim(); if (!text || text.length > 2000) return;
    const aborter = new AbortController(); controller = aborter; const timeout = setTimeout(() => aborter.abort(), 95000);
    setSending(true); let article; let completed = false; const blocks = []; const seen = new Set();
    try {
      const token = await ensureSession(aborter.signal); addMessage('user', text); article = addMessage('assistant'); question.value = ''; starters.hidden = true; announce('Checking evidence and preparing a response...');
      const response = await fetch(`${config.endpoint}/v1/chat/stream`, { method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ message: text, mode: mode.value }), signal: aborter.signal });
      if (!response.ok) throw new Error(await errorText(response));
      await readStream(response, (name, value) => {
        if (completed) throw new Error('Unexpected data after the response completed.');
        if (name === 'block') { if (!validBlock(value) || seen.has(value.id)) throw new Error('The response could not be validated.'); seen.add(value.id); blocks.push(value); addBlock(article, value); announce('A response section is ready.'); }
        else if (name === 'done') { if (value.completed !== true || !blocks.length) throw new Error('The response ended early.'); completed = true; }
        else if (name === 'error') throw new Error('The response could not be completed. Please retry or contact Alex directly.');
      }, aborter.signal);
      if (!completed) throw new Error('The response ended early. Please retry when the connection is stable.');
      const copy = el('button', { type: 'button', class: 'copy', 'aria-label': 'Copy assistant response' }, 'Copy response');
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(blocks.map((block) => (block.kind === 'approach' ? 'Suggested approach, not a claim of prior delivery:\n' : '') + block.text + (block.citations.length ? '\n' + block.citations.map((source) => `${source.label}: ${source.url}`).join('\n') : '')).join('\n\n')); announce('Response copied.'); } catch { announce('Copy is unavailable in this browser.', true); } });
      article.append(copy); announce('Reply ready. Sources link to supporting material.');
    } catch (error) {
      const stopped = aborter.signal.aborted;
      const message = stopped ? 'Generation stopped. Any visible reply is incomplete.' : error instanceof TypeError ? 'The local assistant could not be reached. GitHub and email are still available below.' : (error.message || 'The assistant is temporarily unavailable.');
      if (article) article.append(el('p', { class: 'error' }, message)); announce(message, !stopped);
      if (!question.value) question.value = text;
    } finally { clearTimeout(timeout); aborter.abort(); if (controller === aborter) controller = null; setSending(false); }
  });
  restart.addEventListener('click', async () => {
    controller?.abort(); const old = session; session = null;
    if (old) { try { await fetch(`${config.endpoint}/v1/session`, { method: 'DELETE', mode: 'cors', credentials: 'omit', redirect: 'error', headers: { Authorization: `Bearer ${old.token}` } }); } catch { /* Server TTL still applies if deletion cannot reach the service. */ } }
    log.replaceChildren(); starters.hidden = false; question.value = ''; announce('Conversation cleared here. A new session needs human verification.'); question.focus();
  });
  window.addEventListener('pagehide', () => { controller?.abort(); session = null; });
})();

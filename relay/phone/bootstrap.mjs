// THE RELAY'S FIRST PAGE, the only page the relay itself ever serves. The QR
// code opens it at …/#k=<key>. It keeps the key in the phone, starts the
// worker that carries every request to the Mac (sw.mjs), and reloads into the
// inbox, which then comes from the Mac. It says what is wrong in words when
// it cannot.
import { readKey, writeKey, keyFromHash } from './store.mjs';

const say = (title, line) => {
  document.getElementById('t').textContent = title;
  document.getElementById('p').textContent = line;
};

async function go() {
  if (!('serviceWorker' in navigator) || !window.indexedDB) {
    say('This browser cannot connect', 'Open the link in Safari on an iPhone, or Chrome on Android.');
    return;
  }
  const fromCode = keyFromHash(location.hash);
  const kept = await readKey().catch(() => null);
  // The worker asks for this page as /?boot=stale when the Mac turned the
  // phone away; the address on screen stays the phone's, so the relay marks
  // the page itself (relay/worker.mjs).
  const stale = document.documentElement.dataset.boot === 'stale';
  if (stale && (!fromCode || fromCode === kept)) {
    say('Scan the new code on your computer', 'This phone\'s code is out of date. In Agentbox on your computer, open Settings, then Phone, and scan the code again.');
    return;
  }
  if (fromCode && fromCode !== kept) await writeKey(fromCode);
  if (!fromCode && !kept) {
    say('Scan the code on your computer', 'In Agentbox on your computer, open Settings, then Phone, and scan the code with this phone\'s camera.');
    return;
  }
  await navigator.serviceWorker.register('/relay-sw.js', { scope: '/' });
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  }
  // Into the inbox, through the worker, at the same address: the key stays
  // after the #. A reload, because a change of # alone loads nothing.
  if (!fromCode) history.replaceState(null, '', `/#k=${kept}`);
  location.reload();
}

go().catch((err) => say('Could not connect', String(err?.message ?? err)));

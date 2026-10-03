// The login page. Both forms post JSON built straight from their fields, show the
// server's error text verbatim, and on success do a full navigation so the page gate
// in src/index.js runs with the new cookie.

function submitForm(formId, url, errorId) {
  const form = document.getElementById(formId);
  const button = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    button.classList.add('is-loading');
    try {
      const data = Object.fromEntries(new FormData(form));
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = document.getElementById(errorId);
        err.textContent = await res.text(); // the server's words, verbatim
        err.hidden = false;
        return;
      }
      location.href = '/';
    } catch {
      const err = document.getElementById(errorId);
      err.textContent = 'Connection problem. Check your internet and try again.';
      err.hidden = false;
    } finally {
      button.disabled = false;
      button.classList.remove('is-loading');
    }
  });
}

function showView(name) {
  document.getElementById('login-view').hidden = name !== 'login';
  document.getElementById('register-view').hidden = name !== 'register';
  document.querySelector(`#${name}-form input`).focus();
}

const theme = (() => { try { return localStorage.getItem('wt.theme'); } catch { return null; } })();
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;

submitForm('login-form', '/api/auth/login', 'login-error');
submitForm('register-form', '/api/auth/register', 'register-error');
document.getElementById('show-register').addEventListener('click', () => showView('register'));
document.getElementById('show-login').addEventListener('click', () => showView('login'));

// Face ID / Touch ID / passkey sign-in: no email needed, the device offers this site's
// passkeys and the one chosen says who you are.
async function passkeySignIn() {
  const button = document.getElementById('passkey-btn');
  const err = document.getElementById('passkey-error');
  const show = (message) => { err.textContent = message; err.hidden = false; };
  err.hidden = true;
  button.disabled = true;
  try {
    const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const start = await post('/api/auth/passkey/options', {});
    if (!start.ok) return show(await start.text());
    const { challenge_id: challengeId, options } = await start.json();
    let response;
    try {
      response = await window.Passkeys.get(options);
    } catch (e) {
      if (!window.Passkeys.cancelled(e)) show("Your device couldn't use a passkey. Sign in with your password.");
      return;
    }
    const res = await post('/api/auth/passkey/login', { challenge_id: challengeId, response });
    if (!res.ok) return show(await res.text());
    location.href = '/';
  } catch {
    show('Connection problem. Check your internet and try again.');
  } finally {
    button.disabled = false;
  }
}

if (window.Passkeys?.supported()) {
  document.getElementById('passkey-signin').hidden = false;
  document.getElementById('passkey-btn').addEventListener('click', passkeySignIn);
}

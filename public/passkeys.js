// Passkeys in the browser: turns the server's JSON options into what
// navigator.credentials wants, and the device's answer back into JSON. Shared by the
// sign-in page and the app. No library: these are the only conversions WebAuthn needs.
(() => {
  const toBytes = (b64url) => {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
  };
  const toB64url = (buf) => {
    let s = '';
    for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const withIds = (list = []) => list.map((c) => ({ ...c, id: toBytes(c.id) }));

  const supported = () => typeof window.PublicKeyCredential === 'function' && Boolean(navigator.credentials?.get);

  // Registration: PublicKeyCredentialCreationOptionsJSON → RegistrationResponseJSON.
  async function create(options) {
    const cred = await navigator.credentials.create({
      publicKey: {
        ...options,
        challenge: toBytes(options.challenge),
        user: { ...options.user, id: toBytes(options.user.id) },
        excludeCredentials: withIds(options.excludeCredentials),
      },
    });
    const r = cred.response;
    return {
      id: cred.id,
      rawId: toB64url(cred.rawId),
      type: cred.type,
      authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
      clientExtensionResults: cred.getClientExtensionResults(),
      response: {
        clientDataJSON: toB64url(r.clientDataJSON),
        attestationObject: toB64url(r.attestationObject),
        transports: typeof r.getTransports === 'function' ? r.getTransports() : [],
      },
    };
  }

  // Sign-in: PublicKeyCredentialRequestOptionsJSON → AuthenticationResponseJSON.
  async function get(options) {
    const cred = await navigator.credentials.get({
      publicKey: { ...options, challenge: toBytes(options.challenge), allowCredentials: withIds(options.allowCredentials) },
    });
    const r = cred.response;
    return {
      id: cred.id,
      rawId: toB64url(cred.rawId),
      type: cred.type,
      authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
      clientExtensionResults: cred.getClientExtensionResults(),
      response: {
        clientDataJSON: toB64url(r.clientDataJSON),
        authenticatorData: toB64url(r.authenticatorData),
        signature: toB64url(r.signature),
        userHandle: r.userHandle ? toB64url(r.userHandle) : undefined,
      },
    };
  }

  // The user closing the Face ID prompt isn't an error worth a red message.
  const cancelled = (err) => err?.name === 'NotAllowedError' || err?.name === 'AbortError';

  // A name for the device being added, so the list reads "iPhone", not "Passkey 2".
  function deviceName() {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'iPad';
    if (/Macintosh/.test(ua)) return 'Mac';
    if (/Android/.test(ua)) return 'Android';
    if (/Windows/.test(ua)) return 'Windows';
    return 'This device';
  }

  window.Passkeys = { supported, create, get, cancelled, deviceName };
})();

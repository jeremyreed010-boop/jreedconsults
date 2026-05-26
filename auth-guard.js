// Auth guard — include on every protected page.
// If not signed in, redirects to /login.html.
// Exposes window.sb (Supabase client), window.session, window.authReady (Promise), window.apiFetch.
window.authReady = (async function () {
  const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  window.sb = sb;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = '/login.html';
    return null;
  }
  window.session = session;
  return session;
})();

window.apiFetch = async function (path, options) {
  await window.authReady;
  const opts = Object.assign({}, options || {});
  opts.headers = Object.assign({}, (options && options.headers) || {}, {
    'Authorization': 'Bearer ' + window.session.access_token,
    'Content-Type': 'application/json'
  });
  return fetch(path, opts);
};

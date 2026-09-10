'use strict';
const loginForm = document.getElementById('loginForm');
const logoutForm = document.getElementById('logoutForm');
const form = loginForm || logoutForm;
if (form) form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.getElementById('status');
  const button = form.querySelector('button');
  button.disabled = true; status.textContent = '';
  try {
    const loggingIn = form === loginForm;
    const response = await fetch(loggingIn ? '/api/tool-auth/login' : '/api/tool-auth/logout', {
      method: 'POST', body: loggingIn ? new URLSearchParams(new FormData(form)) : undefined, credentials: 'same-origin',
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to continue');
    location.assign(loggingIn ? '/' : '/login.html');
  } catch (error) { status.textContent = error.message; button.disabled = false; }
});

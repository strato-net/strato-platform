const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');

const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const KRATOS_PUBLIC_URL = process.env.KRATOS_PUBLIC_URL || 'http://kratos:4433';
const KRATOS_BROWSER_URL = process.env.KRATOS_BROWSER_URL || 'http://localhost:8081/auth/kratos';
const KRATOS_ADMIN_URL = process.env.KRATOS_ADMIN_URL || 'http://localhost:4434';
const HYDRA_ADMIN_URL = process.env.HYDRA_ADMIN_URL || 'http://localhost:4445';

const html = (title, content, pageId = '') => `
<!DOCTYPE html>
<html class="login-pf" lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title} - STRATO Auth</title>
  <link rel="icon" href="/auth/ui/img/favicon.ico" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Raleway:wght@300;400;500;600&family=Open+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <script>
    (function() {
      var theme;
      try { theme = localStorage.getItem('kc-theme'); } catch(e) {}
      if (theme !== 'dark' && theme !== 'light') theme = 'light';
      document.documentElement.classList.add(theme === 'dark' ? 'dark-mode' : 'light-mode');
      document.documentElement.setAttribute('data-theme', theme);
    })();
  </script>
  <link href="/auth/ui/css/local.css" rel="stylesheet" />
  <link href="/auth/ui/css/login.css" rel="stylesheet" />
  <link href="/auth/ui/css/mercata.css" rel="stylesheet" />
</head>
<body class="" data-page-id="${pageId}">
  <div class="theme-toggle-container">
    <button type="button" class="theme-toggle-btn" id="theme-toggle" aria-label="Toggle theme" title="Toggle dark/light mode">
      <svg class="sun-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
      <svg class="moon-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
    </button>
  </div>
  <script>
    (function() {
      var btn = document.getElementById('theme-toggle');
      if (!btn) return;
      btn.addEventListener('click', function() {
        var html = document.documentElement;
        var isDark = html.classList.contains('dark-mode');
        var newTheme = isDark ? 'light' : 'dark';
        html.classList.remove('dark-mode', 'light-mode');
        html.classList.add(newTheme === 'dark' ? 'dark-mode' : 'light-mode');
        html.setAttribute('data-theme', newTheme);
        try { localStorage.setItem('kc-theme', newTheme); } catch(e) {}
      });
    })();
  </script>
  <div class="login-pf-page">
    <div id="kc-header" class="login-pf-page-header">
      <div id="kc-header-wrapper" class="">
        <div class="toplogo"></div>
      </div>
    </div>
    <div class="card-pf">
      <header class="login-pf-header">
        <h1 id="kc-page-title">${title}</h1>
      </header>
      <div id="kc-content">
        <div id="kc-content-wrapper">
          ${content}
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`;

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Login page - handles both Kratos self-service and Hydra OAuth
app.get('/login', async (req, res) => {
  const { flow, login_challenge } = req.query;

  // If there's a Hydra login challenge, handle OAuth flow
  if (login_challenge) {
    try {
      // Get login request from Hydra
      const { data: loginRequest } = await axios.get(
        `${HYDRA_ADMIN_URL}/admin/oauth2/auth/requests/login`,
        { params: { login_challenge } }
      );

      // If user is already authenticated, skip login
      if (loginRequest.skip) {
        const { data: completion } = await axios.put(
          `${HYDRA_ADMIN_URL}/admin/oauth2/auth/requests/login/accept`,
          { subject: loginRequest.subject },
          { params: { login_challenge } }
        );
        return res.redirect(completion.redirect_to);
      }

      return res.send(html('Login to STRATO', `
        <div id="kc-form">
          <div id="kc-form-wrapper">
            <form id="kc-form-login" method="POST" action="/auth/ui/login/oauth">
              <input type="hidden" name="login_challenge" value="${login_challenge}">
              <div class="form-group">
                <label for="username" class="pf-c-form__label pf-c-form__label-text">Username or email</label>
                <input id="username" class="pf-c-form-control" name="email" type="text" autofocus autocomplete="username" />
              </div>
              <div class="form-group">
                <label for="password" class="pf-c-form__label pf-c-form__label-text">Password</label>
                <input id="password" class="pf-c-form-control" name="password" type="password" autocomplete="current-password" />
              </div>
              <div id="kc-form-buttons" class="form-group">
                <input class="pf-c-button pf-m-primary pf-m-block btn-lg" name="login" id="kc-login" type="submit" value="Sign In"/>
              </div>
            </form>
          </div>
        </div>
        <div id="kc-info" class="login-pf-signup">
          <div id="kc-info-wrapper" class="">
            <div id="kc-registration-container">
              <span id="mercata-register-or-text">OR</span>
              <div id="kc-registration">
                <span><a href="/auth/ui/registration">Register</a></span>
              </div>
            </div>
          </div>
        </div>
      `, 'login-login'));
    } catch (error) {
      console.error('Hydra login error:', error.response?.data || error.message);
      return res.status(500).send(html('Error', `<div class="alert alert-error">Login error: ${error.message}</div>`));
    }
  }

  // Kratos self-service login flow
  if (flow) {
    try {
      const { data: flowData } = await axios.get(
        `${KRATOS_PUBLIC_URL}/self-service/login/flows`,
        { params: { id: flow }, headers: { Cookie: req.headers.cookie || '' } }
      );

      const csrfToken = flowData.ui.nodes.find(n => n.attributes.name === 'csrf_token')?.attributes.value || '';
      const messages = flowData.ui.messages?.map(m => m.text).join('<br>') || '';

      return res.send(html('Login to STRATO', `
        ${messages ? `<div class="alert alert-error">${messages}</div>` : ''}
        <div id="kc-form">
          <div id="kc-form-wrapper">
            <form id="kc-form-login" method="POST" action="${flowData.ui.action}">
              <input type="hidden" name="csrf_token" value="${csrfToken}">
              <input type="hidden" name="method" value="password">
              <div class="form-group">
                <label for="username" class="pf-c-form__label pf-c-form__label-text">Username or email</label>
                <input id="username" class="pf-c-form-control" name="identifier" type="text" autofocus autocomplete="username" />
              </div>
              <div class="form-group">
                <label for="password" class="pf-c-form__label pf-c-form__label-text">Password</label>
                <input id="password" class="pf-c-form-control" name="password" type="password" autocomplete="current-password" />
              </div>
              <div id="kc-form-buttons" class="form-group">
                <input class="pf-c-button pf-m-primary pf-m-block btn-lg" name="login" id="kc-login" type="submit" value="Sign In"/>
              </div>
            </form>
          </div>
        </div>
        <div id="kc-info" class="login-pf-signup">
          <div id="kc-info-wrapper" class="">
            <div id="kc-registration-container">
              <span id="mercata-register-or-text">OR</span>
              <div id="kc-registration">
                <span><a href="/auth/ui/registration">Register</a></span>
              </div>
            </div>
          </div>
        </div>
      `, 'login-login'));
    } catch (error) {
      console.error('Kratos flow error:', error.response?.data || error.message);
      return res.status(500).send(html('Error', `<div class="alert alert-error">Login flow error. <a href="${KRATOS_BROWSER_URL}/self-service/login/browser">Try again</a></div>`));
    }
  }

  // No flow - always create a fresh Kratos login flow
  res.redirect(`${KRATOS_BROWSER_URL}/self-service/login/browser?refresh=true`);
});

// Handle OAuth login form submission
app.post('/login/oauth', async (req, res) => {
  const { login_challenge, email, password } = req.body;

  try {
    // Verify credentials with Kratos
    // First, create a login flow
    const { data: flow } = await axios.get(
      `${KRATOS_PUBLIC_URL}/self-service/login/api`
    );

    // Submit credentials
    const { data: session } = await axios.post(
      `${KRATOS_PUBLIC_URL}/self-service/login`,
      {
        identifier: email,
        password: password,
        method: 'password'
      },
      { params: { flow: flow.id } }
    );

    // Accept Hydra login
    const { data: completion } = await axios.put(
      `${HYDRA_ADMIN_URL}/admin/oauth2/auth/requests/login/accept`,
      {
        subject: session.session.identity.id,
        remember: true,
        remember_for: 3600
      },
      { params: { login_challenge } }
    );

    res.redirect(completion.redirect_to);
  } catch (error) {
    console.error('OAuth login error:', error.response?.data || error.message);
    res.send(html('Login to STRATO', `
      <div class="alert alert-error">Invalid email or password</div>
      <div id="kc-form">
        <div id="kc-form-wrapper">
          <form id="kc-form-login" method="POST" action="/auth/ui/login/oauth">
            <input type="hidden" name="login_challenge" value="${login_challenge}">
            <div class="form-group">
              <label for="username" class="pf-c-form__label pf-c-form__label-text">Username or email</label>
              <input id="username" class="pf-c-form-control" name="email" value="${email}" type="text" autofocus autocomplete="username" />
            </div>
            <div class="form-group">
              <label for="password" class="pf-c-form__label pf-c-form__label-text">Password</label>
              <input id="password" class="pf-c-form-control" name="password" type="password" autocomplete="current-password" />
            </div>
            <div id="kc-form-buttons" class="form-group">
              <input class="pf-c-button pf-m-primary pf-m-block btn-lg" name="login" id="kc-login" type="submit" value="Sign In"/>
            </div>
          </form>
        </div>
      </div>
      <div id="kc-info" class="login-pf-signup">
        <div id="kc-info-wrapper" class="">
          <div id="kc-registration-container">
            <span id="mercata-register-or-text">OR</span>
            <div id="kc-registration">
              <span><a href="/auth/ui/registration">Register</a></span>
            </div>
          </div>
        </div>
      </div>
    `, 'login-login'));
  }
});

// Consent page for OAuth
app.get('/consent', async (req, res) => {
  const { consent_challenge } = req.query;

  if (!consent_challenge) {
    return res.status(400).send(html('Error', '<div class="alert alert-error">Missing consent challenge</div>'));
  }

  try {
    const { data: consentRequest } = await axios.get(
      `${HYDRA_ADMIN_URL}/admin/oauth2/auth/requests/consent`,
      { params: { consent_challenge } }
    );

    // Auto-accept consent for first-party apps (skip UI)
    if (consentRequest.skip || consentRequest.client.client_id === 'strato-local') {
      const { data: completion } = await axios.put(
        `${HYDRA_ADMIN_URL}/admin/oauth2/auth/requests/consent/accept`,
        {
          grant_scope: consentRequest.requested_scope,
          grant_access_token_audience: consentRequest.requested_access_token_audience,
          remember: true,
          remember_for: 3600,
          session: {
            id_token: {
              sub: consentRequest.subject,
              email: consentRequest.context?.identity?.traits?.email || consentRequest.subject,
              name: consentRequest.context?.identity?.traits?.name || consentRequest.subject
            }
          }
        },
        { params: { consent_challenge } }
      );
      return res.redirect(completion.redirect_to);
    }

    res.send(html('Authorize Application', `
      <div class="alert alert-warning"><strong>${consentRequest.client.client_name || consentRequest.client.client_id}</strong> wants to access your account.</div>
      <p class="instruction">Requested permissions:</p>
      <ul>
        ${consentRequest.requested_scope.map(s => `<li>${s}</li>`).join('')}
      </ul>
      <div id="kc-form">
        <div id="kc-form-wrapper">
          <form method="POST" action="/auth/ui/consent">
            <input type="hidden" name="consent_challenge" value="${consent_challenge}">
            <div id="kc-form-buttons" class="form-group">
              <input class="pf-c-button pf-m-primary pf-m-block btn-lg" type="submit" name="action" value="Allow"/>
            </div>
            <div class="form-group" style="margin-top:-5px">
              <button type="submit" name="action" value="reject" class="pf-c-button pf-m-block btn-lg" style="background:var(--kc-surface);color:var(--kc-text);border:1px solid var(--kc-border);width:100%;height:36px;line-height:36px;font-size:16px;cursor:pointer">Deny</button>
            </div>
          </form>
        </div>
      </div>
    `, 'login-consent'));
  } catch (error) {
    console.error('Consent error:', error.response?.data || error.message);
    res.status(500).send(html('Error', `<div class="alert alert-error">Consent error: ${error.message}</div>`));
  }
});

// Handle consent form submission
app.post('/consent', async (req, res) => {
  const { consent_challenge, action } = req.body;

  try {
    if (action === 'reject') {
      const { data: completion } = await axios.put(
        `${HYDRA_ADMIN_URL}/admin/oauth2/auth/requests/consent/reject`,
        { error: 'access_denied', error_description: 'User denied access' },
        { params: { consent_challenge } }
      );
      return res.redirect(completion.redirect_to);
    }

    const { data: consentRequest } = await axios.get(
      `${HYDRA_ADMIN_URL}/admin/oauth2/auth/requests/consent`,
      { params: { consent_challenge } }
    );

    const { data: completion } = await axios.put(
      `${HYDRA_ADMIN_URL}/admin/oauth2/auth/requests/consent/accept`,
      {
        grant_scope: consentRequest.requested_scope,
        grant_access_token_audience: consentRequest.requested_access_token_audience,
        remember: true,
        remember_for: 3600
      },
      { params: { consent_challenge } }
    );

    res.redirect(completion.redirect_to);
  } catch (error) {
    console.error('Consent submit error:', error.response?.data || error.message);
    res.status(500).send(html('Error', `<div class="alert alert-error">Error: ${error.message}</div>`));
  }
});

// Registration page
app.get('/registration', async (req, res) => {
  const { flow } = req.query;

  if (flow) {
    try {
      const { data: flowData } = await axios.get(
        `${KRATOS_PUBLIC_URL}/self-service/registration/flows`,
        { params: { id: flow }, headers: { Cookie: req.headers.cookie || '' } }
      );

      const csrfToken = flowData.ui.nodes.find(n => n.attributes.name === 'csrf_token')?.attributes.value || '';
      const messages = flowData.ui.messages?.map(m => m.text).join('<br>') || '';
      const fieldMessages = flowData.ui.nodes
        .flatMap(n => (n.messages || []).map(m => m.text))
        .join('<br>');

      return res.send(html('Register', `
        ${messages ? `<div class="alert alert-error">${messages}</div>` : ''}
        ${fieldMessages ? `<div class="alert alert-error">${fieldMessages}</div>` : ''}
        <div id="kc-form">
          <div id="kc-form-wrapper">
            <form id="kc-register-form" method="POST" action="${flowData.ui.action}">
              <input type="hidden" name="csrf_token" value="${csrfToken}">
              <input type="hidden" name="method" value="password">
              <div class="form-group">
                <label for="username" class="pf-c-form__label pf-c-form__label-text">Username</label>
                <input id="username" class="pf-c-form-control" name="traits.username" type="text" autofocus autocomplete="username" />
              </div>
              <div class="form-group">
                <label for="email" class="pf-c-form__label pf-c-form__label-text">Email</label>
                <input id="email" class="pf-c-form-control" name="traits.email" type="email" autocomplete="email" />
              </div>
              <div class="form-group">
                <label for="password" class="pf-c-form__label pf-c-form__label-text">Password</label>
                <input id="password" class="pf-c-form-control" name="password" type="password" autocomplete="new-password" />
              </div>
              <div id="kc-form-buttons" class="form-group">
                <input class="pf-c-button pf-m-primary pf-m-block btn-lg" type="submit" value="Register"/>
              </div>
            </form>
          </div>
        </div>
        <div id="kc-info" class="login-pf-signup">
          <div id="kc-info-wrapper" class="">
            <span><a href="/auth/ui/login">Back to Login</a></span>
          </div>
        </div>
      `, 'login-register'));
    } catch (error) {
      console.error('Registration flow error:', error.response?.data || error.message);
      return res.status(500).send(html('Error', `<div class="alert alert-error">Registration flow error. <a href="${KRATOS_BROWSER_URL}/self-service/registration/browser">Try again</a></div>`));
    }
  }

  res.redirect(`${KRATOS_BROWSER_URL}/self-service/registration/browser`);
});

// Logout
app.get('/logout', async (req, res) => {
  const { logout_challenge } = req.query;

  if (logout_challenge) {
    try {
      const { data: completion } = await axios.put(
        `${HYDRA_ADMIN_URL}/admin/oauth2/auth/requests/logout/accept`,
        {},
        { params: { logout_challenge } }
      );
      return res.redirect(completion.redirect_to);
    } catch (error) {
      console.error('Logout error:', error.response?.data || error.message);
    }
  }

  res.redirect('/auth/ui/login');
});

app.get('/', (req, res) => {
  res.send(html('STRATO Local Auth', `
    <p class="instruction">Local authentication service for STRATO.</p>
    <div id="kc-form">
      <div id="kc-form-wrapper">
        <div id="kc-form-buttons" class="form-group">
          <a href="/auth/ui/login" style="display:block"><input class="pf-c-button pf-m-primary pf-m-block btn-lg" type="button" value="Sign In" onclick="window.location='/auth/ui/login'"/></a>
        </div>
      </div>
    </div>
    <div id="kc-info" class="login-pf-signup">
      <div id="kc-info-wrapper" class="">
        <div id="kc-registration-container">
          <span id="mercata-register-or-text">OR</span>
          <div id="kc-registration">
            <span><a href="/auth/ui/registration">Register</a></span>
          </div>
        </div>
      </div>
    </div>
  `));
});

app.listen(PORT, () => {
  console.log(`Login UI listening on port ${PORT}`);
});

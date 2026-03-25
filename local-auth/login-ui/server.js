const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const PORT = process.env.PORT || 3000;
const KRATOS_PUBLIC_URL = process.env.KRATOS_PUBLIC_URL || 'http://kratos:4433';
const KRATOS_BROWSER_URL = process.env.KRATOS_BROWSER_URL || 'http://localhost:8081/auth/kratos';
const KRATOS_ADMIN_URL = process.env.KRATOS_ADMIN_URL || 'http://localhost:4434';
const HYDRA_ADMIN_URL = process.env.HYDRA_ADMIN_URL || 'http://localhost:4445';

// Simple HTML template
const html = (title, content) => `
<!DOCTYPE html>
<html>
<head>
  <title>${title} - STRATO Auth</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
           max-width: 400px; margin: 50px auto; padding: 20px; }
    h1 { color: #333; }
    form { display: flex; flex-direction: column; gap: 15px; }
    input { padding: 10px; font-size: 16px; border: 1px solid #ddd; border-radius: 4px; }
    button { padding: 12px; font-size: 16px; background: #0066cc; color: white; 
             border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #0052a3; }
    .error { color: #cc0000; background: #ffe6e6; padding: 10px; border-radius: 4px; }
    .info { color: #666; font-size: 14px; }
    a { color: #0066cc; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${content}
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

      // Show login form for OAuth
      return res.send(html('Sign In', `
        <p class="info">Sign in to authorize the application</p>
        <form method="POST" action="/auth/ui/login/oauth">
          <input type="hidden" name="login_challenge" value="${login_challenge}">
          <input type="email" name="email" placeholder="Email" required>
          <input type="password" name="password" placeholder="Password" required>
          <button type="submit">Sign In</button>
        </form>
        <p class="info"><a href="/auth/ui/registration">Create an account</a></p>
      `));
    } catch (error) {
      console.error('Hydra login error:', error.response?.data || error.message);
      return res.status(500).send(html('Error', `<p class="error">Login error: ${error.message}</p>`));
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

      return res.send(html('Sign In', `
        ${messages ? `<p class="error">${messages}</p>` : ''}
        <form method="POST" action="${flowData.ui.action}">
          <input type="hidden" name="csrf_token" value="${csrfToken}">
          <input type="hidden" name="method" value="password">
          <input type="email" name="identifier" placeholder="Email" required>
          <input type="password" name="password" placeholder="Password" required>
          <button type="submit">Sign In</button>
        </form>
        <p class="info"><a href="/auth/ui/registration">Create an account</a></p>
      `));
    } catch (error) {
      console.error('Kratos flow error:', error.response?.data || error.message);
      return res.status(500).send(html('Error', `<p class="error">Login flow error. <a href="${KRATOS_BROWSER_URL}/self-service/login/browser">Try again</a></p>`));
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
    res.send(html('Sign In', `
      <p class="error">Invalid email or password</p>
      <form method="POST" action="/auth/ui/login/oauth">
        <input type="hidden" name="login_challenge" value="${login_challenge}">
        <input type="email" name="email" placeholder="Email" value="${email}" required>
        <input type="password" name="password" placeholder="Password" required>
        <button type="submit">Sign In</button>
      </form>
    `));
  }
});

// Consent page for OAuth
app.get('/consent', async (req, res) => {
  const { consent_challenge } = req.query;

  if (!consent_challenge) {
    return res.status(400).send(html('Error', '<p class="error">Missing consent challenge</p>'));
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

    // Show consent form for third-party apps
    res.send(html('Authorize Application', `
      <p><strong>${consentRequest.client.client_name || consentRequest.client.client_id}</strong> wants to access your account.</p>
      <p class="info">Requested permissions:</p>
      <ul>
        ${consentRequest.requested_scope.map(s => `<li>${s}</li>`).join('')}
      </ul>
      <form method="POST" action="/auth/ui/consent">
        <input type="hidden" name="consent_challenge" value="${consent_challenge}">
        <button type="submit" name="action" value="accept">Allow</button>
        <button type="submit" name="action" value="reject" style="background: #666;">Deny</button>
      </form>
    `));
  } catch (error) {
    console.error('Consent error:', error.response?.data || error.message);
    res.status(500).send(html('Error', `<p class="error">Consent error: ${error.message}</p>`));
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
    res.status(500).send(html('Error', `<p class="error">Error: ${error.message}</p>`));
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

      return res.send(html('Create Account', `
        ${messages ? `<p class="error">${messages}</p>` : ''}
        ${fieldMessages ? `<p class="error">${fieldMessages}</p>` : ''}
        <form method="POST" action="${flowData.ui.action}">
          <input type="hidden" name="csrf_token" value="${csrfToken}">
          <input type="hidden" name="method" value="password">
          <input type="text" name="traits.username" placeholder="Username" required>
          <input type="email" name="traits.email" placeholder="Email" required>
          <input type="password" name="password" placeholder="Password (min 8 characters)" required>
          <button type="submit">Create Account</button>
        </form>
        <p class="info"><a href="/auth/ui/login">Already have an account? Sign in</a></p>
      `));
    } catch (error) {
      console.error('Registration flow error:', error.response?.data || error.message);
      return res.status(500).send(html('Error', `<p class="error">Registration flow error. <a href="${KRATOS_BROWSER_URL}/self-service/registration/browser">Try again</a></p>`));
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

// Home page
app.get('/', (req, res) => {
  res.send(html('STRATO Local Auth', `
    <p>Local authentication service for STRATO.</p>
    <ul>
      <li><a href="/auth/ui/login">Sign In</a></li>
      <li><a href="/auth/ui/registration">Create Account</a></li>
    </ul>
    <h3>Endpoints</h3>
    <ul>
      <li>OAuth Discovery: <a href="http://localhost:8081/auth/.well-known/openid-configuration">/auth/.well-known/openid-configuration</a></li>
    </ul>
  `));
});

app.listen(PORT, () => {
  console.log(`Login UI listening on port ${PORT}`);
});

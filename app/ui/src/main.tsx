import { createRoot } from 'react-dom/client'
import posthog from 'posthog-js'
import App from './App.tsx'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource-variable/bricolage-grotesque'
import './index.css'
import { captureAttribution } from './lib/attribution'
import { trackEngage } from './lib/tracking'

// Capture inbound UTM attribution BEFORE anything else. This must run before
// React mounts and before any Keycloak redirect, which strips the query string.
captureAttribution();

// Tracking-link engagement ping. Unconditional: the session cookie set by the
// /t/<slug> resolver is HttpOnly, so the SPA cannot check for it; the tracking
// service no-ops when the request carries no session.
trackEngage();

// Conditionally initialize PostHog
// Use runtime config (from /config.js) if available, fallback to build-time env var
const posthogKey = (window as any).ENV?.POSTHOG_KEY || import.meta.env.VITE_POSTHOG_KEY;
const posthogHost = (window as any).ENV?.POSTHOG_HOST || import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';
if (posthogKey && posthogKey.trim() !== '') {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    // SPA: PostHog's default pageview capture only fires on full page loads, so
    // history-based route changes must be captured too.
    capture_pageview: 'history_change',
    person_profiles: 'identified_only',
  });
}

// Conditionally load Google Analytics
// Use runtime config (from /config.js) if available, fallback to build-time env var
const gaId = (window as any).ENV?.GOOGLE_ANALYTICS_ID || import.meta.env.VITE_GOOGLE_ANALYTICS_ID;
if (gaId && gaId.trim() !== '') {
  // Load gtag.js library
  const gtagScript = document.createElement('script');
  gtagScript.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
  gtagScript.async = true;
  document.head.appendChild(gtagScript);

  // Initialize dataLayer and gtag (expose gtag globally for custom event tracking)
  (window as any).dataLayer = (window as any).dataLayer || [];
  // Must use 'arguments' object (not rest params) for gtag.js compatibility
  (window as any).gtag = function () {
    (window as any).dataLayer.push(arguments);
  };
  (window as any).gtag('js', new Date());
  // Accept the cross-domain linker (_gl param) the marketing site sends so both
  // strato.nexus and app.strato.nexus share one client ID on the unified property.
  (window as any).gtag('set', 'linker', {
    domains: ['strato.nexus', 'app.strato.nexus'],
    accept_incoming: true,
  });
  (window as any).gtag('config', gaId);
}

createRoot(document.getElementById("root")!).render(<App />);

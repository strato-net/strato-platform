import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Conditionally load Lucky Orange script
// Use runtime config (from /config.js) if available, fallback to build-time env var
const siteId = (window as any).ENV?.LUCKY_ORANGE_SITE_ID || import.meta.env.VITE_LUCKY_ORANGE_SITE_ID;
if (siteId && siteId.trim() !== '') {
  const script = document.createElement('script');
  script.src = `https://tools.luckyorange.com/core/lo.js?site-id=${siteId}`;
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
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
  (window as any).gtag = function (...args: any[]) {
    (window as any).dataLayer.push(args);
  };
  (window as any).gtag('js', new Date());
  (window as any).gtag('config', gaId);
}

createRoot(document.getElementById("root")!).render(<App />);

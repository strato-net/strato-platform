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

// Google tag (gtag.js)
const gtagScript = document.createElement('script');
gtagScript.src = 'https://www.googletagmanager.com/gtag/js?id=G-B5TCWNS0BX';
gtagScript.async = true;
document.head.appendChild(gtagScript);

(window as any).dataLayer = (window as any).dataLayer || [];
(window as any).gtag = function() {
  // eslint-disable-next-line prefer-rest-params
  (window as any).dataLayer.push(arguments);
};
(window as any).gtag('js', new Date());
(window as any).gtag('config', 'G-B5TCWNS0BX');

createRoot(document.getElementById("root")!).render(<App />);

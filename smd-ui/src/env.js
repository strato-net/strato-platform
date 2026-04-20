const ws_protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const oauth_enabled = window.OAUTH_ENABLED && window.OAUTH_ENABLED !== '__OAUTH_ENABLED__' ? window.OAUTH_ENABLED==='true' : process.env.REACT_APP_OAUTH_ENABLED==='true';

export const env = {
  APEX_URL: '/apex-api',
  BLOC_URL: '/bloc/v2.2',
  BLOC_DOC_URL: '/docs/?url=/bloc/v2.2/swagger.json',
  CIRRUS_URL: '/cirrus/search',
  HEALTH_URL: '/health',
  NODE_HOST: window.location.host,
  OAUTH_ENABLED: oauth_enabled,
  STRATO_URL: '/strato-api/eth/v1.2',
  STRATO_URL_V23: '/strato/v2.3',
  STRATO_DOC_URL: '/docs/?url=/strato-api/eth/v1.2/swagger.json',
  SOCKET_SERVER: `${ws_protocol}://${window.location.host}/`,
  POLLING_FREQUENCY: window.POLLING_FREQUENCY && window.POLLING_FREQUENCY !== '__POLLING_FREQUENCY__' ? window.POLLING_FREQUENCY : 5 * 1000,
  STRATO_VERSION: window.STRATO_VERSION && window.STRATO_VERSION !== '__STRATO_VERSION__' ? window.STRATO_VERSION : 'N/A',
};


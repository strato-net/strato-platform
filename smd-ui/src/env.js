const http_protocol = (window.IS_SSL && window.IS_SSL === 'true') ? 'https' : 'http';
const ws_protocol = (window.IS_SSL && window.IS_SSL === 'true') ? 'wss' : 'ws';

const apex_uri = '/apex-api';
const bloc_uri = '/bloc/v2.2';
const bloc_doc_uri = '/docs/?url=/bloc/v2.2/swagger.json';
const cirrus_uri = '/cirrus/search';
const strato_uri = '/strato-api/eth/v1.2';
const strato_doc_uri = '/docs/?url=/strato-api/eth/v1.2/swagger.json';
const strato_v23_uri = '/strato/v2.3'
const health_uri = '/health'

const node_host = window.NODE_HOST && window.NODE_HOST !== '__NODE_HOST__' ? window.NODE_HOST : (process.env.REACT_APP_NODE_HOST ? process.env.REACT_APP_NODE_HOST : 'localhost');
const oauth_enabled = window.OAUTH_ENABLED && window.OAUTH_ENABLED !== '__OAUTH_ENABLED__' ? window.OAUTH_ENABLED==='true' : process.env.REACT_APP_OAUTH_ENABLED==='true';

export const env = {
  NODE_NAME: window.NODE_NAME && window.NODE_NAME !== '__NODE_NAME__' ? window.NODE_NAME : 'LOCALHOST',
  APEX_URL: `${http_protocol}://${node_host}${apex_uri}`,
  BLOC_URL: `${http_protocol}://${node_host}${bloc_uri}`,
  BLOC_DOC_URL: `${http_protocol}://${node_host}${bloc_doc_uri}`,
  CIRRUS_URL: `${http_protocol}://${node_host}${cirrus_uri}`,
  HEALTH_URL: `${http_protocol}://${node_host}${health_uri}`,
  NODE_HOST: node_host,
  OAUTH_ENABLED: oauth_enabled,
  STRATO_URL: `${http_protocol}://${node_host}${strato_uri}`,
  STRATO_URL_V23: `${http_protocol}://${node_host}${strato_v23_uri}`,
  STRATO_DOC_URL: `${http_protocol}://${node_host}${strato_doc_uri}`,
  SOCKET_SERVER: `${ws_protocol}://${node_host}/`,
  POLLING_FREQUENCY: window.POLLING_FREQUENCY && window.POLLING_FREQUENCY !== '__POLLING_FREQUENCY__' ? window.POLLING_FREQUENCY : 5 * 1000,
  STRATO_VERSION: window.STRATO_VERSION && window.STRATO_VERSION !== '__STRATO_VERSION__' ? window.STRATO_VERSION : 'N/A',
};


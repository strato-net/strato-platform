const HTTP_PROTOCOL = (window.IS_SSL && window.IS_SSL === 'true') ? 'https' : 'http';
const WS_PROTOCOL = (window.IS_SSL && window.IS_SSL === 'true') ? 'wss' : 'ws';

export const env = {
  NODE_NAME: window.NODE_NAME && window.NODE_NAME !== '__NODE_NAME__' ? window.NODE_NAME : 'LOCALHOST',
  BLOC_URL: window.BLOC_URL && window.BLOC_URL !== '__BLOC_URL__' ? window.BLOC_URL : `${HTTP_PROTOCOL}://localhost/bloc/v2.2`,
  BLOC_DOC_URL: window.BLOC_DOC_URL && window.BLOC_DOC_URL !== '__BLOC_DOC_URL__' ? window.BLOC_DOC_URL : `${HTTP_PROTOCOL}://localhost/docs/?url=/bloc/v2.2/swagger.json`,
  STRATO_URL: window.STRATO_URL && window.STRATO_URL !== '__STRATO_URL__' ? window.STRATO_URL : `${HTTP_PROTOCOL}://localhost/strato-api/eth/v1.2`,
  STRATO_DOC_URL: window.STRATO_DOC_URL && window.STRATO_DOC_URL !== '__STRATO_DOC_URL__' ? window.STRATO_DOC_URL : `${HTTP_PROTOCOL}://localhost/docs/?url=/strato-api/eth/v1.2/swagger.json`,
  CIRRUS_URL: window.CIRRUS_URL && window.CIRRUS_URL !== '__CIRRUS_URL__' ? window.CIRRUS_URL : `${HTTP_PROTOCOL}://localhost/cirrus/search`,
  APEX_URL: window.APEX_URL && window.APEX_URL !== '__APEX_URL__' ? window.APEX_URL : `${HTTP_PROTOCOL}://localhost/apex-api`,
  POLLING_FREQUENCY: window.POLLING_FREQUENCY && window.POLLING_FREQUENCY !== '__POLLING_FREQUENCY__' ? window.POLLING_FREQUENCY : 5 * 1000,
  STRATO_GS_MODE: window.STRATO_GS_MODE && window.STRATO_GS_MODE !== '__STRATO_GS_MODE__' ? window.STRATO_GS_MODE : '0',
  SINGLE_NODE: window.SINGLE_NODE && window.SINGLE_NODE !== '__SINGLE_NODE__' ? window.SINGLE_NODE : 'false',
  SOCKET_SERVER: window.APEX_URL && window.APEX_URL !== '__APEX_URL__' ? `${WS_PROTOCOL}://${(new URL(window.APEX_URL)).host}/` : `${WS_PROTOCOL}://localhost`,
  SMD_MODE: window.SMD_MODE && window.SMD_MODE !== '__SMD_MODE__' ? window.SMD_MODE : 'enterprise'
};

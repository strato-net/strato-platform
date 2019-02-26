const HTTP_PROTOCOL = (window.IS_SSL && window.IS_SSL === 'true') ? 'https' : 'http';
const WS_PROTOCOL = (window.IS_SSL && window.IS_SSL === 'true') ? 'wss' : 'ws';

const _apex_uri = '/apex-api';
const _bloc_uri = '/bloc/v2.2';
const _bloc_doc_uri = '/docs/?url=/bloc/v2.2/swagger.json';
const _cirrus_uri = '/cirrus/search';
const _strato_uri = '/strato-api/eth/v1.2';
const _strato_doc_uri = '/docs/?url=/strato-api/eth/v1.2/swagger.json';

const _node_url = window.NODE_HOST && window.NODE_HOST !== '__NODE_HOST__' ? `${HTTP_PROTOCOL}://${window.NODE_HOST}` : `${HTTP_PROTOCOL}://localhost`;

export const env = {
  NODE_NAME: window.NODE_NAME && window.NODE_NAME !== '__NODE_NAME__' ? window.NODE_NAME : 'LOCALHOST',
  BLOC_URL: _node_url + _bloc_uri,
  BLOC_DOC_URL: _node_url + _bloc_doc_uri,
  STRATO_URL: _node_url + _strato_uri,
  STRATO_DOC_URL: _node_url + _strato_doc_uri,
  CIRRUS_URL: _node_url + _cirrus_uri,
  APEX_URL: _node_url + _apex_uri,
  POLLING_FREQUENCY: window.POLLING_FREQUENCY && window.POLLING_FREQUENCY !== '__POLLING_FREQUENCY__' ? window.POLLING_FREQUENCY : 5 * 1000,
  STRATO_GS_MODE: window.STRATO_GS_MODE && window.STRATO_GS_MODE !== '__STRATO_GS_MODE__' ? window.STRATO_GS_MODE : '0',
  SINGLE_NODE: window.SINGLE_NODE && window.SINGLE_NODE !== '__SINGLE_NODE__' ? window.SINGLE_NODE : 'false',
  SOCKET_SERVER: window.APEX_URL && window.APEX_URL !== '__APEX_URL__' ? `${WS_PROTOCOL}://${(new URL(window.APEX_URL)).host}/` : `${WS_PROTOCOL}://localhost`,
  SMD_MODE: window.SMD_MODE && window.SMD_MODE !== '__SMD_MODE__' ? window.SMD_MODE : 'enterprise',
  S3_CREDENTIALS: (window.EXT_STORAGE_S3_SECRET_ACCESS_KEY && window.EXT_STORAGE_S3_SECRET_ACCESS_KEY !== '__EXT_STORAGE_S3_SECRET_ACCESS_KEY__') &&
                  (window.EXT_STORAGE_S3_ACCESS_KEY_ID && window.EXT_STORAGE_S3_ACCESS_KEY_ID !== '__EXT_STORAGE_S3_ACCESS_KEY_ID__') &&
                  (window.EXT_STORAGE_S3_BUCKET && window.EXT_STORAGE_S3_BUCKET !== '__EXT_STORAGE_S3_BUCKET__')
};

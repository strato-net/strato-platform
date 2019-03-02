const http_protocol = (window.IS_SSL && window.IS_SSL === 'true') ? 'https' : 'http';
const ws_protocol = (window.IS_SSL && window.IS_SSL === 'true') ? 'wss' : 'ws';

const apex_uri = '/apex-api';
const bloc_uri = '/bloc/v2.2';
const bloc_doc_uri = '/docs/?url=/bloc/v2.2/swagger.json';
const cirrus_uri = '/cirrus/search';
const strato_uri = '/strato-api/eth/v1.2';
const strato_doc_uri = '/docs/?url=/strato-api/eth/v1.2/swagger.json';

const node_host = window.NODE_HOST && window.NODE_HOST !== '__NODE_HOST__' ? window.NODE_HOST : 'localhost';

export const env = {
  NODE_NAME: window.NODE_NAME && window.NODE_NAME !== '__NODE_NAME__' ? window.NODE_NAME : 'LOCALHOST',
  APEX_URL: `${http_protocol}://${node_host}${apex_uri}`,
  BLOC_URL: `${http_protocol}://${node_host}${bloc_uri}`,
  BLOC_DOC_URL: `${http_protocol}://${node_host}${bloc_doc_uri}`,
  CIRRUS_URL: `${http_protocol}://${node_host}${cirrus_uri}`,
  STRATO_URL: `${http_protocol}://${node_host}${strato_uri}`,
  STRATO_DOC_URL: `${http_protocol}://${node_host}${strato_doc_uri}`,
  SOCKET_SERVER: `${ws_protocol}://${node_host}/`,
  POLLING_FREQUENCY: window.POLLING_FREQUENCY && window.POLLING_FREQUENCY !== '__POLLING_FREQUENCY__' ? window.POLLING_FREQUENCY : 5 * 1000,
  STRATO_GS_MODE: window.STRATO_GS_MODE && window.STRATO_GS_MODE !== '__STRATO_GS_MODE__' ? window.STRATO_GS_MODE : '0',
  SINGLE_NODE: window.SINGLE_NODE && window.SINGLE_NODE !== '__SINGLE_NODE__' ? window.SINGLE_NODE : 'false',
  SMD_MODE: window.SMD_MODE && window.SMD_MODE !== '__SMD_MODE__' ? window.SMD_MODE : 'enterprise',
  S3_CREDENTIALS: (window.EXT_STORAGE_S3_SECRET_ACCESS_KEY && window.EXT_STORAGE_S3_SECRET_ACCESS_KEY !== '__EXT_STORAGE_S3_SECRET_ACCESS_KEY__') &&
                  (window.EXT_STORAGE_S3_ACCESS_KEY_ID && window.EXT_STORAGE_S3_ACCESS_KEY_ID !== '__EXT_STORAGE_S3_ACCESS_KEY_ID__') &&
                  (window.EXT_STORAGE_S3_BUCKET && window.EXT_STORAGE_S3_BUCKET !== '__EXT_STORAGE_S3_BUCKET__')
};

const http_protocol = (window.IS_SSL && window.IS_SSL === 'true') ? 'https' : 'http';

const bloc_uri = '/bloc/v2.2';
const cirrus_uri = '/cirrus/search';
const strato_uri = '/strato-api/eth/v1.2';

const node_host = window.NODE_HOST && window.NODE_HOST !== '__NODE_HOST__' ? window.NODE_HOST : 'localhost';

export const env = {
  BLOC_URL: `${http_protocol}://${node_host}/${bloc_uri}`,
  CIRRUS_URL: `${http_protocol}://${node_host}/${cirrus_uri}`,
  STRATO_URL: `${http_protocol}://${node_host}/${strato_uri}`,
  USERKEY: 'user'
};

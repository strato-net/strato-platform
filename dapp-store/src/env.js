const HTTP_PROTOCOL = (window.IS_SSL && window.IS_SSL === 'true') ? 'https' : 'http';

const _bloc_uri = '/bloc/v2.2';
const _cirrus_uri = '/cirrus/search';
const _strato_uri = '/strato-api/eth/v1.2';

const _node_url = window.NODE_HOST && window.NODE_HOST !== '__NODE_HOST__' ? `${HTTP_PROTOCOL}://${window.NODE_HOST}` : `${HTTP_PROTOCOL}://localhost`;

export const env = {
  BLOC_URL: _node_url + _bloc_uri,
  CIRRUS_URL: _node_url + _cirrus_uri,
  STRATO_URL: _node_url + _strato_uri,
  USERKEY: 'user'
};

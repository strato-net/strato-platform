export const env = {
  CIRRUS_URL: window.CIRRUS_URL && window.CIRRUS_URL !== '__CIRRUS_URL__' ? window.CIRRUS_URL : 'http://localhost/cirrus/search',
  BLOC_URL: window.BLOC_URL && window.BLOC_URL !== '__BLOC_URL__' ? window.BLOC_URL : 'http://localhost/bloc/v2.2',
};

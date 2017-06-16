export const env = {
  NODE_NAME: window.NODE_NAME && window.NODE_NAME !== '__NODE_NAME__' ? window.NODE_NAME : 'LOCALHOST',
  BLOC_URL: window.BLOC_URL && window.BLOC_URL !== '__BLOC_URL__' ? window.BLOC_URL : 'http://localhost/bloc/v2.1',
  BLOC_DOC_URL: window.BLOC_DOC_URL && window.BLOC_DOC_URL !== '__BLOC_DOC_URL__' ? window.BLOC_DOC_URL : 'http://localhost/docs/?url=/bloc/v2.1/swagger.json',
  STRATO_URL: window.STRATO_URL && window.STRATO_URL !== '__STRATO_URL__' ? window.STRATO_URL : 'http://localhost/strato-api/eth/v1.2',
  STRATO_DOC_URL: window.STRATO_DOC_URL && window.STRATO_DOC_URL !== '__STRATO_DOC_URL__' ? window.STRATO_DOC_URL : 'http://localhost/docs/?url=/strato-api/eth/v1.2/swagger.json',
  POLLING_FREQUENCY: window.POLLING_FREQUENCY && window.POLLING_FREQUENCY !== '__POLLING_FREQUENCY__' ? window.POLLING_FREQUENCY : 5 * 1000
}

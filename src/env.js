export const NODES = window._NODES_[0].NODE_NAME !== '__NODE_NAME__' ?
  window._NODES_ :
  [
    {
      NODE_NAME: 'LOCALHOST',
      BLOC_URL: 'http://localhost/bloc/v2.1',
      BLOC_DOC_URL: 'http://localhost/docs/?url=/strato-api/eth/v1.2/swagger.json',
      STRATO_URL: 'http://localhost/strato-api/eth/v1.2',
      STRATO_DOC_URL: 'http://localhost/docs/?url=/bloc/v2.1/swagger.json',
    }
  ];

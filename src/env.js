export const NODES = window._NODES_.name !== '__NODE_NAME__' ? [
  {
    name: 'LOCALHOST',
    url: 'http://localhost'
  }
] : window._NODES_;

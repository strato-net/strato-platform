/*
  This will create the URL with the replace of params and create and append the query
  options should contain the query and params parameter.
  Also, this one remove the complexity of chainId. null values will be neglected will not be appended to query
*/
export function createUrl(url, options = {}) {
  const { params, query } = options;

  const withParams = params ? url.replace(/::(\w+)/g, (_, key) => {
    return params[key];
  }) : url;

  return query ? createQuery(withParams, query) : withParams;
}

// query
function createQuery(url, query) {
  const keys = Object.keys(query);

  keys.forEach((key, index) => {
    if (query[key]) {
      if (url.indexOf("?") < 0) {
        url += '?';
      } else {
        url += '&';
      }

      url += `${key}=${query[key]}`;
    }
  });

  return url;
}

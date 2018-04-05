export function gernerateSubQuery(field, operator, value) {
  switch(operator) {
    case 'like' || 'ilike':
      return `${field}=${operator}.*${value}*`
    default:
      return `${field}=${operator}.${value}`
  }
}

export function generateQueryString(aTags) {
  return aTags.reduce((queryString, tag) => {
    let qs = queryString;
    if(qs !== '')
      qs += '&';
    qs += gernerateSubQuery(tag.field, tag.operator, tag.value)
    return qs;
  },'')
}
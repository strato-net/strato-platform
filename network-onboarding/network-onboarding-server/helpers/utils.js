import { rest } from '/blockapps-rest-plus'
import constants from './constants'

const buildOrderQueryOption = (args) => {
  const { sort } = args
  if (sort) {
    const direction = sort.startsWith('+') ? 'asc' : 'desc'
    const field = sort.substr(1)
    return `${field}.${direction}`
  }
  return undefined
}

export const search = async (contractName, args, options, user) => {
  const { queryOptions, limit, offset } = args
  const order = buildOrderQueryOption(args)

  const contractArgs = {
    name: contractName,
  }

  const searchOptions = {
    ...options,
    query: {
      limit: limit || constants.searchLimit,
      offset: offset || 0,
      ...(order ? { order } : {}),
      ...queryOptions,
    },
  }

  const results = await rest.search(user, contractArgs, searchOptions)
  return results
}

export const searchOne = async (contractName, args, options, user) => {
  const searchArgs = {
    ...args,
    limit: 1,
  }

  const results = await search(contractName, searchArgs, options, user)
  return results[0]
}

export const searchAll = async (contractName, args, options, user) => {
  // if at least one query parameter is defined return one page
  if (args.limit || args.offset) {
    const limit = args.limit && args.limit < constants.searchLimit ? args.limit : constants.searchLimit

    const searchArgs = {
      ...args,
      limit,
    }

    const results = await search(contractName, searchArgs, options, user)
    return results
  }

  // else return all pages
  const searchArgs = {
    ...args,
    limit: constants.searchLimit,
    offset: 0,
  }
  const results = []
  let nextResults = []
  do {
    nextResults = await search(contractName, searchArgs, options, user)
    results.push(...nextResults)
    searchArgs.offset += searchArgs.limit
  } while (nextResults.length && nextResults.length === searchArgs.limit)

  return results
}

export const setSearchQueryOptions = (args = {}, _queryOptionsArray) => {
  const queryOptionsArray = Array.isArray(_queryOptionsArray) ? _queryOptionsArray : [_queryOptionsArray]
  const queryOptions = queryOptionsArray.reduce((agg, cur) => {
    const { key, value, predicate = 'eq' } = cur
    if (!value) {
      return agg
    }
    let option = {}
    if (predicate === 'or') {
      const { subPredicate = 'eq' } = cur
      const valueArray = key.reduce((orAgg, orCur) => {
        orAgg.push(`${orCur}.${subPredicate}.${value}`)
        return orAgg
      }, [])
      option = {
        [predicate]: `(${valueArray.join(',')})`,
      }
    } else {
      option = {
        [key]: `${predicate}.${value}`,
      }
    }
    return {
      ...agg,
      ...option,
    }
  }, {})

  const searchArgs = {
    ...args,
    queryOptions: {
      ...args.queryOptions,
      ...queryOptions,
    },
  }
  return searchArgs
}

export const searchAllWithQueryArgs = async (contractName, args, options, user) => {
  const nonQueryOptions = ['queryValue', 'queryFields', 'queryOptions', 'limit', 'offset', 'sort']
  const queryArgs = setSearchQueryOptions(args, Object.keys(args).reduce((result, key) => {
    if (!nonQueryOptions.includes(key)) {
      if (Array.isArray(args[key])) {
        result.push(({ key, value: `(${args[key].join(',')})`, predicate: 'in' }))
      } else {
        result.push(({ key, value: args[key] }))
      }
    }

    if (key === 'queryValue') {
      const { queryValue, queryFields } = args
      if (queryFields) {
        if (Array.isArray(queryFields)) {
          result.push({ key: queryFields, value: `*${queryValue}*`, predicate: 'or', subPredicate: 'ilike' })
        } else {
          result.push({ key: queryFields, value: `*${queryValue}*`, predicate: 'ilike' })
        }
      }
    }

    if (key === 'sort') {
      result.push(args[key])
    }

    return result
  }, []))

  const results = await searchAll(contractName, queryArgs, options, user)

  return results
}

export const setSearchColumns = (args, _columns) => {
  const columns = Array.isArray(_columns) ? _columns.join(',') : _columns
  const searchArgs = {
    ...args,
    queryOptions: {
      ...args.queryOptions,
      select: columns,
    },
  }
  return searchArgs
}

import { rest } from '/blockapps-rest-plus';
import constants from './constants';
import dotenv from 'dotenv';
dotenv.config();

const buildOrderQueryOption = (args) => {
  const { sort } = args;
  if (sort) {
    const direction = sort.startsWith('+') ? 'asc' : 'desc';
    const field = sort.substr(1);
    return `${field}.${direction}`;
  }
  return undefined;
};

export const waitForAddress = async (admin, contract, options) => {
  const org = options.org;

  const app = options.app == contract.name ? undefined : options.app;

  const tableName = org
    ? app
      ? org + '-' + app + '-' + contract.name
      : org + '-' + contract.name
    : contract.name;

  contract['name'] = tableName;

  return await rest.waitForAddress(admin, contract, options);
};

/**
 * Wait for a particular owner address to show up in a particular table.
 * If ContractA creates an instance of ContractB, then we can use waitForOwner to wait for
 * ContractA's address to show up in the owner column of ContractB. Proving that ContractA's instance
 * of ContractB now exists in Cirrus.
 * @param admin User token
 * @param contract Must have an owner and name. Ex. { owner: '123', name: 'MyContract' }
 * @param options Passed options
 */
export const waitForOwner = async (admin, contract, options) => {
  const org = options.org;
  const app = options.app == contract.name ? undefined : options.app;

  const tableName = org
    ? app
      ? org + '-' + app + '-' + contract.name
      : org + '-' + contract.name
    : contract.name;

  contract['name'] = tableName;

  // one from blockapps-rest-plus
  const { chainIds, ...reducedOptions } = options;
  const query = {
    owner: `eq.${contract.owner}`,
  };

  if (chainIds && Array.isArray(chainIds)) {
    query.chainId = `eq.${chainIds[0]}`;
  }

  const searchOptions = {
    query,
    ...reducedOptions,
  };

  function predicate(response) {
    return (
      response !== undefined &&
      response.length !== undefined &&
      response.length > 0
    );
  }

  const results = await rest.searchUntil(
    admin,
    contract,
    predicate,
    searchOptions
  );
  return results[0];
};

export const search = async (contractName, args, options, user) => {
  const { queryOptions, limit, offset } = args;
  const order = buildOrderQueryOption(args);

  const org = options.org;
  const app = options.app == contractName ? undefined : options.app;

  const tableName = org
    ? app
      ? org + '-' + app + '-' + contractName
      : org + '-' + contractName
    : contractName;

  const tableArgs = {
    name: tableName,
  };

  const searchOptions = {
    ...options,
    query: {
      limit: limit || constants.searchLimit,
      offset: offset || 0,
      ...(order ? { order } : {}),
      ...queryOptions,
    },
  };

  const results = await rest.search(user, tableArgs, searchOptions);
  return results;
};

export const searchOne = async (contractName, args, options, user) => {
  const searchArgs = {
    ...args,
    limit: 1,
  };

  const results = await search(contractName, searchArgs, options, user);
  return results[0];
};

export const searchAll = async (contractName, args, options, user) => {
  // if at least one query parameter is defined return one page
  if (args.limit || args.offset) {
    const limit =
      args.limit && args.limit < constants.searchLimit
        ? args.limit
        : constants.searchLimit;

    const searchArgs = {
      ...args,
      limit,
    };

    const results = await search(contractName, searchArgs, options, user);
    return results;
  }

  // else return all pages
  const searchArgs = {
    ...args,
    limit: constants.searchLimit,
    offset: 0,
  };
  const results = [];
  let nextResults = [];
  do {
    nextResults = await search(contractName, searchArgs, options, user);
    results.push(...nextResults);
    searchArgs.offset += searchArgs.limit;
  } while (nextResults.length && nextResults.length === searchArgs.limit);

  return results;
};

export const setSearchQueryOptions = (args = {}, _queryOptionsArray) => {
  const queryOptionsArray = Array.isArray(_queryOptionsArray)
    ? _queryOptionsArray
    : [_queryOptionsArray];
  const queryOptions = queryOptionsArray.reduce((agg, cur) => {
    const { key, value, predicate = 'eq' } = cur;
    if (key === 'order') {
      return {
        ...agg,
        order: value,
      };
    }
    if (key === 'or') {
      return {
        ...agg,
        or: value,
      };
    }
    if (key === 'category') {
      return {
        ...agg,
        ['contract_name']: `ilike(any).{${value.join(',')}}`,
      };
    }
    if (key === 'subcategory' || key === 'subCategory') {
      const subcategoryQueries = value.map(
        (subcategory) => 'contract_name.like.' + subcategory
      );
      return {
        ...agg,
        ['or']: `(${subcategoryQueries.join(',')})`,
      };
    }

    if (!value && typeof value != 'boolean') {
      return agg;
    }
    // Added the value in the arguments that we are getting where key is 'isMint'
    if (key === 'isMint') {
      return {
        ...agg,
        ['or']: `(and(data->>isMint.eq.True,quantity.eq.0),quantity.gt.0)`,
      };
    }
    let option = {};
    if (predicate === 'or') {
      const { subPredicate = 'eq' } = cur;
      const valueArray = key.reduce((orAgg, orCur) => {
        orAgg.push(`${orCur}.${subPredicate}.${value}`);
        return orAgg;
      }, []);
      option = {
        [predicate]: `(${valueArray.join(',')})`,
      };
    } else if (predicate === 'and') {
      const valueArray = key.reduce((andAgg, andCur) => {
        const { name, min = 0, max = 0 } = andCur;
        andAgg.push(`${name}.gte.${min}`, `${name}.lte.${max}`);
        return andAgg;
      }, []);
      option = {
        [predicate]: `(${valueArray.join(',')})`,
      };
    } else {
      option = {
        [key]: `${predicate}.${value}`,
      };
    }
    return {
      ...agg,
      ...option,
    };
  }, {});

  const searchArgs = {
    ...args,
    queryOptions: {
      ...args.queryOptions,
      ...queryOptions,
    },
  };
  return searchArgs;
};

export const setSearchQueryOptionsPrime = (args) => {
  const nonQueryOptions = [
    'queryValue',
    'queryFields',
    'queryOptions',
    'limit',
    'offset',
    'sort',
    'range',
    'notEqualsField',
    'notEqualsValue',
  ];
  const queryArgs = setSearchQueryOptions(
    args,
    Object.keys(args).reduce((result, key) => {
      if (
        !nonQueryOptions.includes(key) &&
        key != 'category' &&
        key != 'subCategory'
      ) {
        if (Array.isArray(args[key])) {
          result.push({
            key,
            value: `(${args[key].join(',')})`,
            predicate: 'in',
          });
        } else {
          result.push({ key, value: args[key] });
        }
      }

      if (key === 'category' && Array.isArray(args[key])) {
        const categories = args[key][0]
          .split(',')
          .map((category) => '%' + category + '%');
        result.push({
          key,
          value: categories,
          predicate: 'or',
          subPredicate: 'like',
        });
      }

      if (key === 'subCategory' && Array.isArray(args[key])) {
        const subCategories = args[key][0]
          .split(',')
          .map((subCategory) => '%-' + subCategory);
        result.push({
          key,
          value: subCategories,
          predicate: 'or',
          subPredicate: 'like',
        });
      }

      if (key === 'queryValue') {
        const { queryValue, queryFields } = args;
        if (queryFields) {
          if (Array.isArray(queryFields)) {
            result.push({
              key: queryFields,
              value: `*${queryValue}*`,
              predicate: 'or',
              subPredicate: 'ilike',
            });
          } else {
            result.push({
              key: queryFields,
              value: `*${queryValue}*`,
              predicate: 'ilike',
            });
          }
        }
      }

      if (key === 'sort') {
        result.push(args[key]);
      }

      if (key == 'range') {
        if (Array.isArray(args[key])) {
          const queryArray = args[key].reduce((agg, cum) => {
            const rangeFilter = cum.split(',');
            const [name, min = 0, max = 0] = rangeFilter;
            agg.push({
              name,
              min,
              max,
            });
            return agg;
          }, []);
          if (queryArray.length > 0) {
            result.push({
              key: queryArray,
              value: queryArray,
              predicate: 'and',
            });
          }
        }
      }

      if (key === 'notEqualsValue') {
        const { notEqualsField, notEqualsValue } = args;
        if (Array.isArray(args[key])) {
          notEqualsField.map((field, i) => {
            if (Array.isArray(notEqualsValue[i])) {
              result.push({
                key: field,
                value: `(${notEqualsValue[i].join(',')})`,
                predicate: 'not.in',
              });
            } else {
              result.push({
                key: field,
                value: notEqualsValue[i],
                predicate: 'neq',
              });
            }
          });
        } else {
          if (Array.isArray(notEqualsField)) {
            result.push({
              key: notEqualsField,
              value: `(${notEqualsValue.join(',')})`,
              predicate: 'not.in',
            });
          } else {
            result.push({
              key: notEqualsField,
              value: notEqualsValue,
              predicate: 'neq',
            });
          }
        }
      }
      // Added to remove the unusable inventories when (isMint==true && quantity==0) OR  (quantity>0)
      if (key === 'isMint') {
        result.push({
          key,
          value: `(and(data->>isMint.eq.True,quantity.eq.0),quantity.gt.0)`,
          predicate: 'or',
        });
      }

      return result;
    }, [])
  );
  return queryArgs;
};

export const setSearchQueryOptionsLike = (args = {}, _queryOptionsArray) => {
  const queryOptionsArray = Array.isArray(_queryOptionsArray)
    ? _queryOptionsArray
    : [_queryOptionsArray];
  const queryOptions = queryOptionsArray.reduce((agg, cur) => {
    let { key, value, predicate = 'like' } = cur;
    if (!value) {
      return agg;
    }
    if (key == 'and') {
      return {
        ...agg,
        [key]: value,
      };
    }
    let option = {};
    if (predicate === 'or') {
      const { subPredicate = 'eq' } = cur;
      const valueArray = key.reduce((orAgg, orCur) => {
        orAgg.push(`${orCur}.${subPredicate}.${value}`);
        return orAgg;
      }, []);
      option = {
        [predicate]: `(${valueArray.join(',')})`,
      };
    } else if (predicate === 'and') {
      const valueArray = key.reduce((andAgg, andCur) => {
        const { name, min = 0, max = 0 } = andCur;
        andAgg.push(`${name}.gte.${min}`, `${name}.lte.${max}`);
        return andAgg;
      }, []);
      option = {
        [predicate]: `(${valueArray.join(',')})`,
      };
    } else if (
      value === 'true' ||
      value === 'false' ||
      typeof value == 'boolean'
    ) {
      option = {
        [key]: `eq.${value}`,
      };
    } else {
      let searchedValue = value;
      if (predicate === 'like') {
        searchedValue = `*${value}*`;
      }
      option = {
        [key]: `${predicate}.${searchedValue}`,
      };
    }
    return {
      ...agg,
      ...option,
    };
  }, {});

  const searchArgs = {
    ...args,
    queryOptions: {
      ...args.queryOptions,
      ...queryOptions,
    },
  };
  return searchArgs;
};

export const searchAllWithQueryArgs = async (
  contractName,
  args,
  options,
  user
) => {
  const nonQueryOptions = [
    'queryValue',
    'queryFields',
    'queryOptions',
    'limit',
    'offset',
    'sort',
    'range',
    'gtField',
    'gtValue',
    'gteField',
    'gteValue',
    'ltField',
    'ltValue',
    'lteField',
    'lteValue',
    'notEqualsField',
    'notEqualsValue',
  ];
  const queryArgs = setSearchQueryOptions(
    args,
    Object.keys(args).reduce((result, key) => {
      if (
        !nonQueryOptions.includes(key) &&
        key != 'category' &&
        key != 'subCategory' &&
        key != 'isMint'
      ) {
        if (Array.isArray(args[key])) {
          result.push({
            key,
            value: `(${args[key].join(',')})`,
            predicate: 'in',
          });
        } else {
          result.push({ key, value: args[key] });
        }
      }

      if (key === 'category' && Array.isArray(args[key])) {
        const categories = args[key][0]
          .split(',')
          .map((category) => '%' + category + '%');
        result.push({
          key,
          value: categories,
          predicate: 'or',
          subPredicate: 'like',
        });
      }

      if (key === 'subCategory' && Array.isArray(args[key])) {
        const subCategories = args[key][0]
          .split(',')
          .map((subCategory) => '%-' + subCategory);
        result.push({
          key,
          value: subCategories,
          predicate: 'or',
          subPredicate: 'like',
        });
      }

      // Added to remove the unusable inventories when (isMint==true && quantity==0) OR  (quantity>0)
      if (key === 'isMint') {
        result.push({
          key,
          value: `(and(data->>isMint.eq.True,quantity.eq.0),quantity.gt.0)`,
          predicate: 'or',
        });
      }

      if (key === 'queryValue') {
        const { queryValue, queryFields } = args;
        if (queryFields) {
          if (Array.isArray(queryFields)) {
            result.push({
              key: queryFields,
              value: `*${queryValue}*`,
              predicate: 'or',
              subPredicate: 'ilike',
            });
          } else {
            result.push({
              key: queryFields,
              value: `*${queryValue}*`,
              predicate: 'ilike',
            });
          }
        }
      }

      if (key === 'gtValue') {
        const { gtField, gtValue } = args;
        result.push({ key: gtField, value: gtValue, predicate: 'gt' });
      }

      if (key === 'ltValue') {
        const { ltField, ltValue } = args;
        result.push({ key: ltField, value: ltValue, predicate: 'lt' });
      }

      if (key === 'gteValue') {
        const { gteField, gteValue } = args;
        result.push({ key: gteField, value: gteValue, predicate: 'gte' });
      }

      if (key === 'lteValue') {
        const { lteField, lteValue } = args;
        result.push({ key: lteField, value: lteValue, predicate: 'lte' });
      }

      if (key === 'notEqualsValue') {
        const { notEqualsField, notEqualsValue } = args;
        if (Array.isArray(args[key])) {
          notEqualsField.map((field, i) => {
            if (Array.isArray(notEqualsValue[i])) {
              result.push({
                key: field,
                value: `(${notEqualsValue[i].join(',')})`,
                predicate: 'not.in',
              });
            } else {
              result.push({
                key: field,
                value: notEqualsValue[i],
                predicate: 'neq',
              });
            }
          });
        } else {
          if (Array.isArray(notEqualsField)) {
            result.push({
              key: notEqualsField,
              value: `(${notEqualsValue.join(',')})`,
              predicate: 'not.in',
            });
          } else {
            result.push({
              key: notEqualsField,
              value: notEqualsValue,
              predicate: 'neq',
            });
          }
        }
      }

      if (key === 'sort') {
        result.push(args[key]);
      }

      if (key == 'range') {
        if (Array.isArray(args[key])) {
          const queryArray = args[key].reduce((agg, cum) => {
            const rangeFilter = cum.split(',');
            const [name, min = 0, max = 0] = rangeFilter;
            agg.push({
              name,
              min,
              max,
            });
            return agg;
          }, []);
          if (queryArray.length > 0) {
            result.push({
              key: queryArray,
              value: queryArray,
              predicate: 'and',
            });
          }
        }
      }
      return result;
    }, [])
  );

  const { category, ...restQueryArgs } = queryArgs;
  console.log('#### REST QUERY ARGS', JSON.stringify(restQueryArgs));
  const results = await searchAll(contractName, restQueryArgs, options, user);

  return results;
};

export const setSearchColumns = (args, _columns) => {
  const columns = Array.isArray(_columns) ? _columns.join(',') : _columns;
  const searchArgs = {
    ...args,
    queryOptions: {
      ...args.queryOptions,
      select: columns,
    },
  };
  return searchArgs;
};

export const pollingHelper = async (
  func,
  argsToFunc,
  attemptNumber = 0,
  attemptsAllowed = 8,
  milliseconds = 1000
) => {
  if (attemptsAllowed < attemptNumber) return null;
  let result = await func(...argsToFunc);
  if (!(result === null || result === undefined)) return result;
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
  return pollingHelper(
    func,
    argsToFunc,
    attemptNumber + 1,
    attemptsAllowed,
    milliseconds
  );
};

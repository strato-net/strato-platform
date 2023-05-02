import { importer, rest, util } from 'blockapps-rest'
import RestStatus from 'http-status-codes'
import categoryJs from './category'
import subCategoryJs from './subCategory'
import { setSearchQueryOptions, searchOne, searchAll, searchAllWithQueryArgs } from '../../helpers/utils';



const contractName = 'CategoryManager'
const contractFilename = `${util.cwd}/dapp/categories/contracts/CategoryManager.sol`

async function uploadContract(admin, args = {}, options) {
  
    const source = await importer.combine(contractFilename)
    const contractArgs = {
      name: contractName,
      source,
      args: util.usc(args),
    }
  
    const contract = await rest.createContract(admin, contractArgs, options)
    contract.src = 'removed'
  
    return bind(admin, contract, options)
}

function bind(admin, _contract, contractOptions) {
    const contract = {
      ..._contract,
    }

    contract.get = async function (args, options = contractOptions) {
      return get(admin, args, options)
    }
    contract.getAll = async function (args, options = contractOptions) {
      return getAll(admin, args, options)
    }
    contract.createCategory = async function (args, options = contractOptions) {
      return createCategory(admin, contract, args, options)
    }
    contract.updateCategory = async function (args, options = contractOptions) {
      return updateCategory(admin, contract, args, options)
    }
    contract.getSubCategory = async function (args, options = contractOptions) {
      return getSubCategory(admin, args, options)
    }
    contract.getSubCategories = async function (args, options = contractOptions) {
      return getSubCategories(admin, args, options)
    }
    contract.createSubCategory = async function (args, options = contractOptions) {
      return createSubCategory(admin, contract, args, options)
    }
    contract.updateSubCategory = async function (args, options = contractOptions) {
      return updateSubCategory(admin, contract, args, options)
    }
  
  
    return contract
  }

  function bindAddress(user, address, options) {
    const contract = {
      name: contractName,
      address,
    }
    return bind(user, contract, options)
  }

  async function get(admin, args, options) {
    const { uniqueCategoryID, address, ...restArgs } = args
    let category
  
    if (address) {
      const searchArgs = setSearchQueryOptions(restArgs, { key: 'address', value: address })
      category = await searchOne(categoryJs.contractName, searchArgs, options, admin)
    }
    else {
      const searchArgs = setSearchQueryOptions(restArgs, { key: 'uniqueCategoryID', value: uniqueCategoryID })
      category = await searchOne(categoryJs.contractName, searchArgs, options, admin)
    }
    if (!category) {
      return undefined
    }
    return categoryJs.marshalOut(category)
  }

  async function getAll(admin, args = {}, options) {
    const { chainIds, ...restArgs } = args

    const searchArgs = setSearchQueryOptions(restArgs, { key: 'chainId', value: chainIds  })
    const categories = await searchAll(categoryJs.contractName, searchArgs, options, admin)
    return categories.map((category) => categoryJs.marshalOut(category))
  }

  async function createCategory(admin, contract, _args, baseOptions) {
    const args = categoryJs.marshalIn(_args)

    const callArgs = {
      contract,
      method: 'createCategory',
      args: util.usc(args),
    }
    
    const options = {
      ...baseOptions,
      history: [categoryJs.contractName],
    }

    const [restStatus, CategoryAddress] = await rest.call(admin, callArgs, options)

    if (parseInt(restStatus, 10) !== RestStatus.CREATED) {
      throw new rest.RestError(restStatus, 0, { callArgs })
    }

    return [restStatus, CategoryAddress];
}

async function updateCategory(admin, contract, _args, baseOptions) {
  const args = categoryJs.marshalIn(_args)

  const scheme = Object.keys(_args).reduce((agg, key) => {
    const base = 1
    switch (key) {
      case 'name':
        return agg | (base << 0)
      case 'description':
        return agg | (base << 1)
      case 'imageKey':
        return agg | (base << 2)
      case 'createdDate':
        return agg | (base << 3)
      default:
        return agg
    }
  }, 0)

  const callArgs = {
    contract,
    method: 'updateCategory',
    args: util.usc({
      scheme,
      ...args
    }),
  }

  const options = {
    ...baseOptions,
    history: [contractName],
  }

  const [restStatus, CategoryAddress] = await rest.call(admin, callArgs, options)

  if (parseInt(restStatus, 10) !== RestStatus.OK) {
    throw new rest.RestError(restStatus, 0, { callArgs })
  }

  return [restStatus, CategoryAddress];
}

async function getSubCategory(user, args, options) {
  const { uniqueSubCategoryID, address, ...restArgs } = args;
  let subCategory;

  if (address) {
      const searchArgs = setSearchQueryOptions(restArgs, { key: 'address', value: address });
      subCategory = await searchOne(subCategoryJs.contractName, searchArgs, options, user);
  } else {
      const searchArgs = setSearchQueryOptions(restArgs, { key: 'uniqueSubCategoryID', value: uniqueSubCategoryID });
      subCategory = await searchOne(subCategoryJs.contractName, searchArgs, options, user);
  }
  if (!subCategory) {
      return undefined;
  }

  return subCategoryJs.marshalOut(subCategory);
}

async function getSubCategories(admin, args = {}, options) {
  const subCategorys = await searchAllWithQueryArgs(subCategoryJs.contractName, args, options, admin)
  return subCategorys.map((subCategory) => subCategoryJs.marshalOut(subCategory))
}

async function createSubCategory(admin, contract, _args, baseOptions) {
  const callArgs = {
    contract,
    method: 'createSubCategory',
    args: util.usc({
      ..._args
    }),
  }
  const options = {
    ...baseOptions,
    history: [contractName],
  }

  const [restStatus, subCategoryAddress] = await rest.call(admin, callArgs, options)

  if (parseInt(restStatus, 10) !== RestStatus.OK) throw new rest.RestError(restStatus, 0, { callArgs })

  return [restStatus, subCategoryAddress];
}

async function updateSubCategory(admin, contract, _args, baseOptions) {

  const scheme = Object.keys(_args).reduce((agg, key) => {
    const base = 1
    switch (key) {
      case 'name':
        return agg | (base << 0)
      case 'description':
        return agg | (base << 1)
      case 'createdDate':
        return agg | (base << 2)
      default:
        return agg
    }
  }, 0)
  const callArgs = {
    contract,
    method: 'updateSubCategory',
    args: util.usc({
      scheme,
      ..._args
    }),
  }

  const options = {
    ...baseOptions,
    history: [categoryJs.contractName],
  }
  const [restStatus, subCategoryAddress] = await rest.call(admin, callArgs, options)

  if (parseInt(restStatus, 10) !== RestStatus.OK) throw new rest.RestError(restStatus, 0, { callArgs })

  return [restStatus, subCategoryAddress];
}

export default {
  uploadContract,
  bind,
  bindAddress,
  get,
  getAll,
  createCategory,
  updateCategory,
  getSubCategory,
  getSubCategories,
  createSubCategory,
  updateSubCategory,
  contractName
}
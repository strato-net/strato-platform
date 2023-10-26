import { importer, rest, util } from 'blockapps-rest'
import RestStatus from 'http-status-codes'
import paymentJs from './payment'
import userAddressJs from "/dapp/addresses/userAddress.js";
import paymentProviderJs from './paymentProvider';
import { setSearchQueryOptions, searchOne, searchAll, searchAllWithQueryArgs } from '../../helpers/utils';



const contractName = 'Mem_PaymentManager'
const contractFilename = `${util.cwd}/dapp/payments/contracts/PaymentManager.sol`

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
  contract.createPayment = async function (args, options = contractOptions) {
    return createPayment(admin, contract, args, options)
  }
  contract.updatePayment = async function (args, options = contractOptions) {
    return updatePayment(admin, contract, args, options)
  }
  contract.createUserAddress = async function (args, options = contractOptions) {
    return createUserAddress(admin, contract, args, options)
  }
  contract.createPaymentProvider = async function (args, options = contractOptions) {
    return createPaymentProvider(admin, contract, args, options)
  }
  contract.updatePaymentProvider = async function (args, options = contractOptions) {
    return updatePaymentProvider(admin, contract, args, options)
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
// TODO update once test it
async function get(admin, args, options) {
  const { paymentSessionId, address, ...restArgs } = args
  let category

  if (address) {
    const searchArgs = setSearchQueryOptions(restArgs, { key: 'address', value: address })
    category = await searchOne(paymentJs.contractName, searchArgs, options, admin)
  }
  else {
    const searchArgs = setSearchQueryOptions(restArgs, { key: 'paymentSessionId', value: paymentSessionId })
    category = await searchOne(paymentJs.contractName, searchArgs, options, admin)
  }
  if (!category) {
    return undefined
  }
  return paymentJs.marshalOut(category)
}

async function getAll(admin, args = {}, options) {
  const { chainIds, ...restArgs } = args

  const searchArgs = setSearchQueryOptions(restArgs, { key: 'chainId', value: chainIds })
  const categories = await searchAll(paymentJs.contractName, searchArgs, options, admin)
  return categories.map((category) => paymentJs.marshalOut(category))
}

async function createPayment(admin, contract, _args, baseOptions) {
  const args = paymentJs.marshalIn(_args)

  const callArgs = {
    contract, method: 'createPayment', args: util.usc(args),
  }

  const options = {
    ...baseOptions,
    history: [paymentJs.contractName],
  }

  const [restStatus, paymentAddress] = await rest.call(admin, callArgs, options)

  if (parseInt(restStatus, 10) !== RestStatus.CREATED) {
    throw new rest.RestError(restStatus, 0, { callArgs })
  }

  return [restStatus, paymentAddress];
}

async function updatePayment(admin, contract, _args, baseOptions) {
  // const args = paymentJs.marshalIn(_args)
  const args = { ..._args }
  const scheme = Object.keys(_args).reduce((agg, key) => {
    const base = 1
    switch (key) {
      case 'paymentStatus':
        return agg | (base << 0)
      case 'sessionStatus':
        return agg | (base << 1)
      case 'paymentIntentId':
        return agg | (base << 2)
      default:
        return agg
    }
  }, 0)

  const callArgs = {
    contract,
    method: 'updatePayment',
    args: util.usc({
      scheme,
      ...args
    }),
  }

  const options = {
    ...baseOptions,
    history: [contractName],
  }

  const [restStatus, paymentAddress] = await rest.call(admin, callArgs, options)

  if (parseInt(restStatus, 10) !== RestStatus.OK) {
    throw new rest.RestError(restStatus, 0, { callArgs })
  }

  return [restStatus, paymentAddress];
}

async function createUserAddress(admin, contract, _args, baseOptions) {
  const args = userAddressJs.marshalIn(_args)

  const callArgs = {
    contract,
    method: 'createUserAddress',
    args: util.usc(args),
  }

  const options = {
    ...baseOptions,
    history: [userAddressJs.contractName],
  }

  const [restStatus, userAddress] = await rest.call(admin, callArgs, options)

  if (parseInt(restStatus, 10) !== RestStatus.CREATED) {
    throw new rest.RestError(restStatus, 0, { callArgs })
  }

  return [restStatus, userAddress];
}

async function createPaymentProvider(admin, contract, _args, baseOptions) {
  const args = paymentProviderJs.marshalIn(_args)

  const callArgs = {
    contract,
    method: 'createPaymentProvider',
    args: util.usc(args),
  }

  const options = {
    ...baseOptions,
    history: [paymentProviderJs.contractName],
  }

  const [restStatus, paymentProviderAddress] = await rest.call(admin, callArgs, options)

  if (parseInt(restStatus, 10) !== RestStatus.CREATED) {
    throw new rest.RestError(restStatus, 0, { callArgs })
  }

  return [restStatus, paymentProviderAddress];
}

async function updatePaymentProvider(admin, contract, _args, baseOptions) {
  const args = { ..._args }

  const scheme = Object.keys(_args).reduce((agg, key) => {
    const base = 1;
    switch (key) {
      case "chargesEnabled":
        return agg | (base << 0);
      case "detailsSubmitted":
        return agg | (base << 1);
      case "payoutsEnabled":
        return agg | (base << 2);
      case "eventTime":
        return agg | (base << 3);
      case "accountDeauthorized":
        return agg | (base << 4);
      default:
        return agg;
    }
  }, 0);

  const callArgs = {
    contract,
    method: "updatePaymentProvider",
    args: util.usc({
      scheme,
      ...args,
    }),
  };

  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus, paymentProviderAddress] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, paymentProviderAddress];
}



export default {
  uploadContract,
  bind,
  bindAddress,
  get,
  getAll,
  createPayment,
  createUserAddress,
  createPaymentProvider,
  updatePaymentProvider,
  contractName
}
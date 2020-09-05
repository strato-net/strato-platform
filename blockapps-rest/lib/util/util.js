import path from 'path'

/**
 * This is the util interface
 * @module util
 */

// odds
const cwd = path.resolve(process.cwd())

/**
 * @see https://github.com/ethereum/go-ethereum/blob/aa9fff3e68b1def0a9a22009c233150bf9ba481f/jsre/ethereum_js.go
 *
 * Checks if the given string is an address
 * @example
 * const simpleStorageSrc = fsUtil.get("SimpleStorage.sol");
 * const contractArgs = {
 *   name: "SimpleStorage",
 *   source: simpleStorageSrc,
 *   args: {} // Any constructor args would go here. We dont have any.
 * };
 * const result = await rest.createContract(stratoUser, contractArgs, options);
 * // Returns
 * // true
 * @method isAddress
 * @param {String} address the given HEX adress
 * @return {Boolean}
 */
function isAddress(address) {
  // check if it has the basic requirements of an address
  if (!/^(0x)?[0-9a-f]{40}$/i.test(address)) {
    return false
  }
  // If it's all small caps or all all caps, return true
  if (/^(0x)?[0-9a-f]{40}$/.test(address) || /^(0x)?[0-9A-F]{40}$/.test(address)) {
    return true
  }
  // Otherwise check each case
  return isChecksumAddress(address)
}

function isHash(hash) {
  return /([A-Fa-f0-9]{64})$/.test(hash)
}

/**
 * Checks if the given string is a checksummed address
 * @method isChecksumAddress
 * @param {String} address the given HEX adress
 * @return {Boolean}
 */
function isChecksumAddress(_address) {
  // Check each case
  const address = _address.replace('0x', '')
  const addressHash = sha3(address.toLowerCase())
  for (let i = 0; i < 40; i++) {
    // the nth letter should be uppercase if the nth digit of casemap is 1
    if ((parseInt(addressHash[i], 16) > 7 && address[i].toUpperCase() !== address[i]) || (parseInt(addressHash[i], 16) <= 7 && address[i].toLowerCase() !== address[i])) {
      return false
    }
  }
  return true
}

/**
 * Generates a unique integer id
 * @example
 * util.iuid()
 * // Returns
 * // 654657412219
 * @method iuid
 * @return {Int}
 */
function iuid() {
  return this.uid(undefined, 12);
}

function sha3(address) {
  throw new Error('sha3 not found')
}

/**
 * Generates a unique id
 * @example
 * util.uid()
 * // Returns
 * // 100549
 * @method uid
 * @param prefix Optional. The prefix of the unique id to be generated
 * @param digits Optional. The number of digits of the unique id to be generated. Defaults to 6.
 * @return {Int}
 */
function uid(prefix, digits = 6) {
  if (digits < 1) digits = 1
  if (digits > 16) digits = 16
  const random = Math.floor(Math.random() * (10 ** digits))
  return (prefix === undefined) ? `${random}` : `${prefix}_${random}`
}

/**
 * Formats an object's properties
 * @example
 * util.usc({ size: 10, length: 5 })
 * // Returns
 * // { _size: 10, _length: 5 }
 * @method usc
 * @param {*} Object An object with properties
 * @return {Object}
 */
function usc(args) {
  return Object.keys(args).reduce((acc, key) => {
    acc[`_${key}`] = args[key]
    return acc
  }, {})
}

/**
 * Parse a command line argument as an integer
 * @param {*} argName Name of the command line argument
 * @param {*} defaultValue Default value to use if argument is not present
 */
function getArgInt(argName, defaultValue) {
  const index = process.argv.indexOf(argName);
  if (index <= 0 ) {
    if (defaultValue !== undefined ) return defaultValue;
    throw new Error(`Argument not found ${argName}`);
  }
  const stringValue = process.argv[index+1];
  const intValue = parseInt(stringValue);
  if (isNaN(intValue)) throw new Error(`Invalid int value for ${argName} : ${stringValue}`);
  return intValue;
}

async function sleep(milli) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve()
    }, milli)
  })
}

/**
 * Perform action (a promise) until predicate evaluates to true
 * @example
 * // Consider the following function in the rest module
 * // async function searchUntil(user, contract, predicate, options) {
 * //  const action = async o => {
 * //    return search(user, contract, o);
 * //   };
 * //
 * //   const results = await util.until(predicate, action, options);
 * //   return results;
 * // }
 *
 * // predicate is created: to wait until response is available otherwise throws the error
 * function predicate(data) {};
 * const result = await rest.searchUntil(stratoUser, {name: "SimpleStorage"}, predicate, queryOptions);
 * // Returns
 * // [ { address: '60fb089dc62858df014819d618aa3f43391ddb9c',
 * //     chainId: '',
 * //     block_hash:
 * //      'fb7edc20a2678ca60024f81d926d1637eb418012beae2fedb7e7c4250406ea82',
 * //     block_timestamp: '2020-08-04 20:48:18 UTC',
 * //     block_number: '3',
 * //     transaction_hash:
 * //      '32321367696882da2feb9483fa31346f68abf77cc1a01ace6ef5a2b774bc8d38',
 * //     transaction_sender: '594f19ad4a55d6434711a51f628f22abf4afc55a',
 * //     transaction_function_name: '',
 * //     storedData: 10 } ]
 * @method until
 * @param {*} predicate The function that evaluates to a boolean.
 * @param {*} action A promise to invoke. Could be a network request.
 * @param {*} options Ba-rest options
 * @param {*} timeout The length of time to wait before giving up on the predicate
 * @return {Object}
 */

async function until(predicate, action, options, timeout = 60000) {
  const phi = 10
  let dt = 500
  let totalSleep = 0
  while (totalSleep < timeout) {
    const result = await action(options)
    if (predicate(result)) {
      return result
    }
    await sleep(dt)
    totalSleep += dt
    dt += phi
  }
  throw new Error(`until: timeout ${timeout} ms exceeded`)
}

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check for intersection
 * @method filter_isContained
 * @param {*} setA A list
 * @param {*} setB Another list
 * @param {*} comparator Comparator to compare elements of setA and setB
 * @param {*} isDebug Debug mode
 */
// TODO: pass options instead of isDebug
 function filter_isContained(setA, setB, comparator, isDebug) {
  if (isDebug) {
    console.log('setA', setA);
    console.log('setB', setB);
  }
  return setA.filter(function (memberA) {
    return !setB.filter(function (memberB) {
      // compare
      return comparator(memberA, memberB);
    }).length > 0; // some items were found in setA that are not included in setB
  });
}

/**
 * Convert an array to a comma separated string
 * @example
 * util.toCsv([1, 2, 3, 4])
 * // Returns
 * // 1,2,3,4
 * @method toCsv
 * @param {*} array List to convert to csv value
 * @return {String}
 */
function toCsv(array) {
  return array.reduce(function (prevVal, elem) {
    return prevVal + (prevVal.length > 0 ? ',' : '') + elem;
  }, '');
}



export default {
  cwd,
  filter_isContained,
  getArgInt,
  isAddress,
  isHash,
  iuid,
  uid,
  usc,
  sleep,
  until,
  timeout,
  toCsv
}

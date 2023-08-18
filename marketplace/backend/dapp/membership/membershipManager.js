import { util, rest, importer } from '/blockapps-rest-plus';
import config from '/load.config';
import RestStatus from 'http-status-codes';
import { setSearchQueryOptions, searchOne, searchAll, searchAllWithQueryArgs } from '/helpers/utils';
import dayjs from 'dayjs';


const contractName = 'MembershipManager';
const contractFilename = `${util.cwd}/dapp/membership/contracts/MembershipManager.sol`;

/** 
 * Upload a new MembershipManager 
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of Membership's constructor
 * @param options  deployment options (found in _/config/*.config.yaml_ via _load.config.js_) 
 * @returns Contract object
 * */
async function uploadContract(user, _constructorArgs, options) {
    const constructorArgs = marshalIn(_constructorArgs);

    const contractArgs = {
        name: contractName,
        source: await importer.combine(contractFilename),
        args: util.usc(constructorArgs),
    };

    let error = [];

    if (error.length) {
        throw new Error(error.join('\n'));
    }

    const copyOfOptions = {
        ...options,
        history: contractName
      }

    const contract = await rest.createContract(user, contractArgs, copyOfOptions);
    contract.src = 'removed';

    return bind(user, contract, copyOfOptions);
}


//@title A representation of MembershipManager to manage membership and inventory
//contract MembershipManager is RestStatus{
//
//
//    address owner;
//    address[] public memberships;
//    mapping(address => address[]) private membershipServices; 
//    mapping(address => address[]) private productFiles; 
//
//
//
//    constructor() public returns (address){
//        owner = msg.sender;
//
//
//
//    }
//
//
//    struct MembershipArgs {
//        string name;
//        string description;
//        string manufacturer;
//        UnitOfMeasurement unitOfMeasurement;
//        string userUniqueMembershipCode;
//        uint uniqueMembershipCode;
//        int leastSellableUnit;
//        string imageKey;
//        bool isActive;
//        string category;
//        string subCategory;
//        uint createdDate;
//        int timePeriodInMonths;
//        string additionalInfo;
//    }
//
//
//    struct MembershipServiceArgs {
//        address serviceId;
//        int membershipPrice;
//        int discountPrice;
//        int maxQuantity;
//        int createdDate;
//        bool isActive;
//    }
//
//    struct ProductFileArgs {
//        string fileLocation;
//        string fileHash;
//        string fileName;
//        int uploadDate;
//        uint createdDate;
//        ProductFileSection section;
//        ProductFileType type;
//    }
//
//    function addMembership(address _dappAdress, MembershipArgs _membershipArgs, MembershipServiceArgs[] _membershipServiceArgs, ProductFileArgs[] _productFileArgs) 
//        returns (uint256, address) {
//
//
//        Dapp dapp = Dapp(account(_dappAddress, "parent"));
//
//        if (dapp == address(0)) {
//            return (RestStatus.NOT_FOUND, address(0));
//        }
//
//        ProductManager productManager = ProductManager(dapp.productManager());
//
//
//
//        address product;
//        RestStatus rs;
//
//        (rs,product) = productManager.addProduct(_membershipArgs.name, _membershipArgs.description, _membershipArgs.manufacturer, 
//                                                 _membershipArgs.unitOfMeasurement, _membershipArgs.userUniqueMembershipCode,
//                                                 _membershipArgs.uniqueMembershipCode, _membershipArgs.leastSellableUnit,
//                                                 _membershipArgs.imageKey, _membershipArgs.isActive, _membershipArgs.category,
//                                                 _membershipArgs.subCategory, _membershipArgs.createdDate);
//        
//        Membership membership = new Membership(address(product), _timePeriodInMonths, _additionalInfo, _createdDate);
//
//        //iterate throught MembershipServiceArgs array and create MembershipServices 
//
//        for(uint i = 0; i < _membershipServiceArgs.length; i++) {
//            MembershipServiceArgs membershipServiceArg = _membershipServiceArgs[i];
//            MembershipService membershipService = new MembershipService(address(membership), 
//                                                                        membershipServiceArg.serviceId, 
//                                                                        membershipServiceArg.membershipPrice, 
//                                                                        membershipServiceArg.discountPrice, 
//                                                                        membershipServiceArg.maxQuantity, 
//                                                                        membershipServiceArg.createdDate, 
//                                                                        membershipServiceArg.isActive);
//            //add membershipService to membershipServices mapping 
//            membershipServices[address(membership)].push(address(membershipService));
//
//        }
//
//        for (uint i = 0; i < _productFileArgs.length; i++) {
//            ProductFileArgs productFileArg = _productFileArgs[i];
//            ProductFile productFile = new ProductFile(address(product), 
//                                                        productFileArg.fileLocation, 
//                                                        productFileArg.fileHash, 
//                                                        productFileArg.fileName, 
//                                                        productFileArg.uploadDate, 
//                                                        productFileArg.createdDate, 
//                                                        productFileArg.section, 
//                                                        productFileArg.type);
//
//            //add productFile to productFiles mapping
//            productFiles[address(product)].push(address(productFile));
//        }
//
//        //add membership to memberships array
//        memberships.push(address(membership));
//
//
//        return (RestStatus.OK, address(membership));
//    }
//

//
//Passing Complex Data Structures to Transaction Arguments
//
//STRATO v7.6 added support for passing complex data structures in contract creation and function call API requests in SolidVM contracts. This allows users to use these data types as arguments in these API calls. Below are added types supported and how to send them in a API request:
//
//Multidimensional Arrays
//
//Multidimensional arrays can be sent as normal multidimensional JSON arrays.
//
//Example
//Structs
//
//Structs can be sent to the API as JSON objects, where each key of the object represents a data-point in the Solidity struct.
//
//Please note is up to the user to ensure the shape of the struct passed to the API matches the definition of the struct. Doing otherwise will raise an exception in VM.
//
//Example
//
//contract StructExample {
//
//  struct MyStruct {
//    int x;
//    int y;
//  }
//  int z;
//
//  constructor(MyStruct _myStruct) {
//    z = _myStruct.x + _myStruct.y;
//  }
//}
//
//Transaction Arguments:
//
//...,
//args: {
//  _myStruct: {
//    x: 1,
//    y: 2,
//  }
//}
//

function marshalIn(_args) {
    const defaultArgs = {};
   
    const args = {
        ...defaultArgs,
        ..._args,
    };
    return args;
}

async function getHistory(user, chainId, address, options) {
    const contractArgs = {
        name: `history@${contractName}`,
    }

    const copyOfOptions = {
        ...options,
        query: {
            address: `eq.${address}`,
        },
        chainIds: [chainId]
    }

    const history = await rest.search(user, contractArgs, copyOfOptions)
    return history
}

/**
 * Augment returned contract state before it is returned.
 * Its counterpart is {@link marshalIn `marshalIn`}.
 * 
 * As our arguments come into the membership contract they first pass through {@link marshalIn `marshalIn`} 
 * and when we retrieve contract state they pass through `marshalOut`.
 * 
 * (A mathematical analogy: {@link marshalIn `marshalIn`} and `marshalOut` form something like a 
 * homomorphism) 
 * @param _args - Contract state
 */
function marshalOut(_args) {
    const args = {
        ..._args,
    };
    return args;
}

/**
 * Bind functions relevant for membership to the _contract object. 
 * @param user User token
 * @param _contract Contract object from `rest.createContract()` etc.
 * @param options Membership deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */


function bind(user, _contract, options) {
    const contract = { ..._contract };

    contract.createMembership = async (args) => createMembership(user, contract, args, options);
    contract.getHistory = async (args, options = contractOptions) => getHistory(user, chainId, args, options);
    contract.chainIds = options.chainIds;

    return contract;
}

/** 
 * Bind an existing Membership contract to a new user token. Useful for having multiple users test
 * the same contract.
 * @example <caption>Create an admin and user bound to the same new membership contract.</caption>
 * const adminBoundContract = uploadContract(adminToken, args, options);
 * const userBoundContract = bindAddress(userToken, adminBoundContract.address, options);
 * @param user User token
 * @param address Address of the Membership contract
 * @param options Membership deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */
function bindAddress(user, address, options) {
    const contract = {
        name: contractName,
        address,
    };
    return bind(user, contract, options);
}

/**
 * Get contract state in bloc.
 * @deprecated Use {@link get `get`} instead.
 */
async function getState(user, contract, options) {
    const state = await rest.getState(user, contract, options);
    return marshalOut(state);
}

/**
 * create a new Membership 
 */

async function createMembership(user, contract, args, options) {

    const callArgs = {
        contract,
        method: 'createMembership',
        args: util.usc(args),
    };
    const createMembershipStatus = await rest.call(user, callArgs, options);

    console.log('createMembershipStatus', createMembershipStatus);

    if (parseInt(createMembershipStatus, 10) !== RestStatus.OK) {
        throw new rest.RestError(createMembershipStatus, 'You cannot create a Membership', { args })
    }

    return createMembershipStatus
}


export default {
    uploadContract,
    contractName,
    contractFilename,
    bindAddress,
    bind,
    getState,
    createMembership,
    marshalIn,
    marshalOut,
    getHistory
}

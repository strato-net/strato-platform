import { rest } from 'blockapps-rest'
import config from "/load.config"
import constants from '/helpers/constants'
import RestStatus from 'http-status-codes';
import { setSearchQueryOptions, searchOne, searchAllWithQueryArgs } from '/helpers/utils'

// Utility functions for getting Certificates from the CertRegistry Dapp on the main chain in Mercata
const defaultOptions = { config }

async function getCertificate(admin, args = {}, options = defaultOptions) {
    const parsedArgs = Object.entries(args).map(([key, value]) => {
        return { key, value }
    })
    
    const searchArgs = setSearchQueryOptions({}, [...parsedArgs,{key:"order",value:"block_timestamp.desc"}])
    const user = await searchOne(constants.certificateContractName, searchArgs, options, admin)
    
    if (!user) {
        return undefined
    }
    
    return user
}

async function getCertificateMe(admin, options = defaultOptions) {
    const me = await getCertificate(admin, {userAddress: admin.address}, options)
    return me;
}

async function getCertificates(admin, args = {}, options = defaultOptions) {
    const certs = await searchAllWithQueryArgs(constants.certificateContractName, args, options, admin)
    return certs
}

// USING user commonname 
// -> query User table in cirrus to get user contract address 
// -> call "authorizeSeller" method via strato api with address 
async function authorizeSeller(admin, args, options=defaultOptions) {   
    const {commonName} = args;
    // todo put in constants
    const searchOptions = {...options, query: {authorizedSeller: 'not.is.null', commonName: `eq.${commonName}`, limit: 1}}
    let user = await rest.search(admin, {name: 'BlockApps-UserRegisry-User'}, searchOptions)
    console.log('AYA LOGS - user', user);
    
    const callArgs = {
        contract: {address: user[0].address},
        method: "authorizeSeller",
        args: {}
    };
    
    const authorizationStatus = await rest.call(admin, callArgs, options);

    if (parseInt(authorizationStatus, 10) !== RestStatus.OK) {
        throw new rest.RestError(
            authorizationStatus,
            "You cannot resell the item because it has already been sold by the original owner.",
            { callArgs }
        );
    }
    
    return authorizationStatus;
}

async function deauthorizeSeller(admin, args, options=defaultOptions) {   
    const {commonName} = args;
    // todo put in constants
    const searchOptions = {...options, query: {authorizedSeller: 'not.is.null', commonName: `eq.${commonName}`, limit: 1}}
    let user = await rest.search(admin, {name: 'BlockApps-UserRegistry-User'}, searchOptions)
    console.log('AYA LOGS - user', user);
    
    const callArgs = {
        contract: {address: user[0].address},
        method: "deauthorizeSeller",
        args: {}
    };
    
    const authorizationStatus = await rest.call(admin, callArgs, options);

    if (parseInt(authorizationStatus, 10) !== RestStatus.OK) {
        throw new rest.RestError(
            authorizationStatus,
            "You cannot resell the item because it has already been sold by the original owner.",
            { callArgs }
        );
    }
    
    return authorizationStatus;
}

export default {
    getCertificate,
    getCertificateMe,
    getCertificates,
    authorizeSeller,
    deauthorizeSeller,
}
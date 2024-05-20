import RestStatus from 'http-status-codes'
import { rest } from 'blockapps-rest'
import config from "/load.config"
import constants from '/helpers/constants'
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

// --------------------------- USER WALLETS ---------------------------
const userSearchOptions = {notEqualsField: 'issuerStatus', notEqualsValue: 'null', sort: '-block_timestamp', limit: 1}

async function requestReview(admin, args, options=defaultOptions) {   
    const { commonName } = args;
    const searchOptions = { commonName: commonName, ...userSearchOptions };
    const user = await searchAllWithQueryArgs(constants.userContractName, searchOptions, options, admin);
    
    if (user[0]) {  
        try {
            const callArgs = {
                contract: {address: user[0].address},
                method: "requestReview",
                args: {}
            };
            await rest.call(admin, callArgs, options);
        } catch {
            throw new rest.RestError(
                RestStatus.INTERNAL_SERVER_ERROR,
                "Could not set issuer as pending review"
            );
        }
    } else {
        throw new rest.RestError(
            RestStatus.BAD_REQUEST,
            "No user contract found to modify the issuer status of"
        );
    }
}

async function authorizeIssuer(admin, args, options=defaultOptions) {   
    const { commonName } = args;
    const searchOptions = { commonName: commonName, ...userSearchOptions };
    const user = await searchAllWithQueryArgs(constants.userContractName, searchOptions, options, admin);
    
    if (user[0]) {
        try {
            const callArgs = {
                contract: {address: user[0].address},
                method: "authorizeIssuer",
                args: {}
            };    
            await rest.call(admin, callArgs, options);
        } catch (e) {
            throw new rest.RestError(
                RestStatus.FORBIDDEN,
                "Only admins can authorize an issuer"
            );
        }
    } else {
        throw new rest.RestError(
            RestStatus.BAD_REQUEST,
            "No user found with that username"
        );
    }
}

async function deauthorizeIssuer(admin, args, options=defaultOptions) {   
    const {commonName} = args;
    const searchOptions = { commonName: commonName, ...userSearchOptions };
    const user = await searchAllWithQueryArgs(constants.userContractName, searchOptions, options, admin);
    
    if (user[0]) {
        try {
            const callArgs = {
                contract: {address: user[0].address},
                method: "deauthorizeIssuer",
                args: {}
            };     
            await rest.call(admin, callArgs, options);
        } catch {
            throw new rest.RestError(
                RestStatus.FORBIDDEN,
                "Only admins can deauthorize an issuer"
            );
        }
    } else {
        throw new rest.RestError(
            RestStatus.BAD_REQUEST,
            "No user found with that username"
        );
    }
}

export default {
    getCertificate,
    getCertificateMe,
    getCertificates,
    requestReview,
    authorizeIssuer,
    deauthorizeIssuer,
}
import * as R from 'ramda';
import { util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';
import dappJs from '/dapp/dapp/dapp'
import constants from '/helpers/constants';
import RestStatus from 'http-status-codes';
import orderJs from '../order';
import factory from '../factory/order.factory';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of Order
 */
describe('Order', function () {
    this.timeout(config.timeout);

    let globalAdmin;
    let contract;
    let dapp;
    let newOptions;

    let factoryArgs;
    const updateBuyerFactoryArgs = (user) => ({ ...(factory.getUpdateBuyerOrderArgs(util.uid()))});
    const updateSellerFactoryArgs = (user) => ({ ...(factory.getUpdateSellerOrderArgs(util.uid()))});
    const OrderLineFactoryArgs = (user) => ({ ...(factory.getOrderLineArgs(util.uid()))});

    before(async () => {
        assert.isDefined(
            config.configDirPath,
            "configDirPath is  missing. Set in config"
        )
        assert.isDefined(
            config.deployFilename,
            "deployFilename is missing. Set in config"
        )
        assert.isDefined(
            process.env.GLOBAL_ADMIN_NAME,
            "GLOBAL_ADMIN_NAME is missing. Add it to .env file"
        )
        assert.isDefined(
            process.env.GLOBAL_ADMIN_PASSWORD,
            "GLOBAL_ADMIN_PASSWORD is missing. Add it to .env file"
        )

        let adminUserName = process.env.GLOBAL_ADMIN_NAME
        let adminUserPassword = process.env.GLOBAL_ADMIN_PASSWORD

        let adminUserToken
        try {
            adminUserToken = await oauthHelper.getUserToken(adminUserName, adminUserPassword)
        } catch (e) {
            console.error("ERROR: Unable to fetch the user token, check your username and password in your .env", e)
            throw e
        }
        let adminCredentials = { token: adminUserToken }
        console.log("getting admin user's address:", adminUserName)
        const adminResponse = await oauthHelper.getStratoUserFromToken(adminCredentials.token)
        console.log("adminResponse", adminResponse)


        assert.strictEqual(
            adminResponse.status,
            RestStatus.OK,
            adminResponse.message
        )
        globalAdmin = { ...adminResponse.user, ...adminCredentials }

        dapp = await dappJs.loadFromDeployment({ token: adminUserToken }, `${config.configDirPath}/${config.deployFilename}`, options);
        newOptions={
            // app:'MyApp',
            org:dapp.managers.cirrusOrg,
            ...options
        }
        factoryArgs = (user) => ({ ...(factory.getOrderArgs(util.uid(),constants.buyerOrgName,dapp.managers.cirrusOrg))});
    });
    // TODO : there should be two different users for Buyer and seller and two different test suites to check their permissions 
    // ! currently User from any other org except deployer is not able to create private chain

    it('Create Order - 201', async () => {
        // Create Order via upload
        const args = factoryArgs(globalAdmin)
        contract = await orderJs.uploadContract(globalAdmin, args, newOptions);
        const orderData = await contract.get();

        assert.deepInclude(
            // Convert the Order data into strings as the args are in strings
            R.map(v => '' + v, orderData),
            R.map(v => '' + v, args));
    });

    describe('Buyer Org',()=>{

        it('createOrder', async () => {
            const args = factoryArgs(globalAdmin);
            const order = await orderJs.uploadContract(globalAdmin, args, newOptions);
            const orderData = await order.get();
            // Sorting is needed in order to allow for chainIds to be in any order
            // Convert all fields into a string to allow for equality checking
            assert.deepInclude(
                // Convert the Order data into strings as the args are in strings
                R.map(v => '' + v, orderData),
                R.map(v => '' + v, args));
        });
    
        it('createOrder (multiple)', async () => {
            const args1 = factoryArgs(globalAdmin);
            const args2 = factoryArgs(globalAdmin);
            const args3 = factoryArgs(globalAdmin);
            const args4 = factoryArgs(globalAdmin);
            const order1 = await orderJs.uploadContract(globalAdmin, args1, newOptions);
            const order2 = await orderJs.uploadContract(globalAdmin, args2, newOptions);
            const order3 = await orderJs.uploadContract(globalAdmin, args3, newOptions);
            const order4 = await orderJs.uploadContract(globalAdmin, args4, newOptions);
            const orderData1 = await order1.get();
            const orderData2 = await order2.get();
            const orderData3 = await order3.get();
            const orderData4 = await order4.get();
            // Our logic shouldn't mix up orders
            assert.deepInclude(R.map(v => '' + v, orderData1), R.map(v => '' + v, args1));
            assert.deepInclude(R.map(v => '' + v, orderData2), R.map(v => '' + v, args2));
            assert.deepInclude(R.map(v => '' + v, orderData3), R.map(v => '' + v, args3));
            assert.deepInclude(R.map(v => '' + v, orderData4), R.map(v => '' + v, args4));
        });
        
        it('addOrderLine of order - 403', async () => {
            // create the order
            const args = factoryArgs(globalAdmin);
            const order = await orderJs.uploadContract(globalAdmin, args, newOptions);
    
            // Check if order was created
            const orderData = await order.get();
            // Sorting is needed in order to allow for chainIds to be in any order
            // Convert all fields into a string to allow for equality checking
            assert.deepInclude(
                // Convert the Order data into strings as the args are in strings
                R.map(v => '' + v, orderData),
                R.map(v => '' + v, args));
            
            // add the orderLine
            const orderLineArgs = OrderLineFactoryArgs(globalAdmin);
            
    
            await assert.restStatus(async ()=>{
                await order.addOrderLine(orderLineArgs);
            },RestStatus.FORBIDDEN);
        })
    });

    describe('Seller org',()=>{
    //  TODO once the bug is fixed write the test for seller
    });
});
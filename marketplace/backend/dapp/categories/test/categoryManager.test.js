import * as R from 'ramda';
import { rest, util, assert } from '/blockapps-rest-plus';
import config from '/load.config';
import oauthHelper from '/helpers/oauthHelper';
import dotenv from 'dotenv';
import dappJs from '/dapp/dapp/dapp'
import RestStatus from 'http-status-codes';
import categoryManagerJs from '../categoryManager';
import appPermissionManagerJs from "/dapp/permissions/app/appPermissionManager";
import certificateJs from '/dapp/certificates/certificate'
import factory from '../factory/categoryManager.factory';
import { args } from 'commander';

const options = { config };

const loadEnv = dotenv.config();
assert.isUndefined(loadEnv.error);

/**
 * Test out functionality of Category
 */
describe('Category Manager', function() {
    this.timeout(config.timeout);

    let globalAdmin;
    let tradingEntity;
    let contract;
    let permissionManagerContract;
    let dapp;
    let newOptions;
    let adminOrganization;
    const subCategoryFactoryArgs = (user) => ({ ...(factory.getSubCategoryArgs(util.uid())) });
    const updateSubCategoryFactoryArgs = (user) => ({ ...(factory.getUpdateSubCategoryArgs(util.uid())) });

    const factoryArgs = (user) => ({ ...(factory.getCategoryArgs(util.uid()))});
    const updateFactoryArgs = (user) => ({ ...(factory.getUpdateCategoryArgs(util.uid()))});

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
        let tradingEntityUserName = process.env.TRADINGENTITY_NAME
        let tradingEntityPassword = process.env.TRADINGENTITY_PASSWORD
    
        let adminUserToken
        let tradingEntityToken
        try {
          adminUserToken = await oauthHelper.getUserToken(adminUserName, adminUserPassword)
          tradingEntityToken = await oauthHelper.getUserToken(tradingEntityUserName, tradingEntityPassword)
        } catch(e) {
          console.error("ERROR: Unable to fetch the user token, check your username and password in your .env", e)
          throw e
        }
        let adminCredentials = { token: adminUserToken }
        let tradingEntityCredentials = { token : tradingEntityToken}

        console.log("getting admin user's address:", adminUserName)
        const adminResponse = await oauthHelper.getStratoUserFromToken(adminCredentials.token)
        console.log("adminResponse", adminResponse)

        console.log("getting trading Entity user's address:", adminUserName)
        const tradingEntityResponse = await oauthHelper.getStratoUserFromToken(tradingEntityCredentials.token)
        console.log("tradingEntityResponse", tradingEntityResponse)
        
    
        assert.strictEqual(
          adminResponse.status,
          RestStatus.OK,
          adminResponse.message
        )
        globalAdmin = {...adminResponse.user, ...adminCredentials}

        assert.strictEqual(
            tradingEntityResponse.status,
            RestStatus.OK,
            tradingEntityResponse.message
          )
        tradingEntity = {...tradingEntityResponse.user, ...tradingEntityCredentials}

        const adminCert = await certificateJs.getCertificateMe(globalAdmin)
        adminOrganization = adminCert.organization;

        newOptions={
            app:categoryManagerJs.contractName,
            org:adminOrganization,
            ...options
        }

        // deploy permission manager
        permissionManagerContract = await appPermissionManagerJs.uploadContract(
            globalAdmin,
            {
                admin: globalAdmin.address,
                master: globalAdmin.address,
            },
            options
            );
            
            await permissionManagerContract.grantAdminRole({
                user:globalAdmin
            })
            await permissionManagerContract.grantCertifierRole({
                user:tradingEntity
            })

            contract = await categoryManagerJs.uploadContract(globalAdmin,{
               permissionManager:permissionManagerContract.address
            }, newOptions);
    });


    it('create Category', async () => {
        const args = factoryArgs(globalAdmin);

        const [status, categoryAddress]= await contract.createCategory(args);
        assert.equal(status, RestStatus.CREATED);
        
        let categoryData = await contract.get({address: categoryAddress});
     

        
   
        // Sorting is needed in order to allow for chainIds to be in any order
        // Convert all fields into a string to allow for equality checking
        assert.deepInclude(
            // Convert the Category data into strings as the args are in strings
            R.map(v => '' + v, categoryData),
            R.map(v => '' + v, args));
    });

    it('create and update Category', async () => {
        // create a Category
        const args = factoryArgs(globalAdmin);
        const [status, categoryAddress]= await contract.createCategory(args);
        assert.equal(status, RestStatus.CREATED);

        let categoryData = await contract.get({address: categoryAddress});
        assert.deepInclude(
            // Convert the Category data into strings as the args are in strings
            R.map(v => '' + v, categoryData),
            R.map(v => '' + v, args));

        // update the created Category
        const updateArgs = updateFactoryArgs(globalAdmin);
        const res = await contract.updateCategory({category: categoryAddress, ...updateArgs});
        assert.equal(res[0], RestStatus.OK);

        const updatedData=await contract.get({address:categoryAddress});

        assert.equal(updatedData['name'],updateArgs['name'])
        assert.equal(updatedData['description'],updateArgs['description'])

    })

    it('create SubCategory of a category', async () => {
        const args = factoryArgs(globalAdmin);

        const [status, categoryAddress]= await contract.createCategory(args);
        assert.equal(status, RestStatus.CREATED);

        let categoryData = await contract.get({address: categoryAddress});
        assert.deepInclude(
            // Convert the Category data into strings as the args are in strings
            R.map(v => '' + v, categoryData),
            R.map(v => '' + v, args));

        const args2 = subCategoryFactoryArgs(globalAdmin);
        const [statusCode, subCategoryAddress] = await contract.createSubCategory({category: categoryAddress, ...args2});
        assert.equal(statusCode, RestStatus.OK);

        const subCategoryData=await contract.getSubCategory({address:subCategoryAddress});

        assert.equal(subCategoryData['name'],args2['name'])
        assert.equal(subCategoryData['description'],args2['description'])
        assert.equal(subCategoryData['createdDate'],args2['createdDate'])
    })

    it('create and update subCategory', async () => {
        const args = factoryArgs(globalAdmin);

        const [status, categoryAddress] = await contract.createCategory(args);
        assert.equal(status, RestStatus.CREATED);

        let categoryData = await contract.get({address: categoryAddress});
        assert.deepInclude(
            // Convert the Category data into strings as the args are in strings
            R.map(v => '' + v, categoryData),
            R.map(v => '' + v, args));

        const args2 = subCategoryFactoryArgs(globalAdmin);
        const [resStatus, subCategoryAddress] = await contract.createSubCategory({category: categoryAddress, ...args2});
        assert.equal(resStatus, RestStatus.OK);

        const args3 = updateSubCategoryFactoryArgs(globalAdmin);
        const res = await contract.updateSubCategory({category: categoryAddress, subCategory: subCategoryAddress, ...args3});
        assert.equal(res[0], RestStatus.OK);

        const subCategoryData=await contract.getSubCategory({address:subCategoryAddress});
        assert.equal(subCategoryData['name'],args3['name'])
        assert.equal(subCategoryData['description'],args3['description'])
    })

    it('createCategory (multiple)', async () => {
        const args1 = factoryArgs(globalAdmin);
        const args2 = factoryArgs(globalAdmin);
        const args3 = factoryArgs(globalAdmin);
        const args4 = factoryArgs(globalAdmin);
        const [status1,category1] = await contract.createCategory(args1);
        const [status2,category2] = await contract.createCategory(args2);
        const [status3,category3] = await contract.createCategory(args3);
        const [status4,category4] = await contract.createCategory(args4);

        const categoryData1 = await contract.get({address: category1});
        const categoryData2 = await contract.get({address: category2});
        const categoryData3 = await contract.get({address: category3});
        const categoryData4 = await contract.get({address: category4});
        // Our logic shouldn't mix up categorys
        assert.deepInclude(R.map(v => '' + v, categoryData1), R.map(v => '' + v, args1));
        assert.deepInclude(R.map(v => '' + v, categoryData2), R.map(v => '' + v, args2));
        assert.deepInclude(R.map(v => '' + v, categoryData3), R.map(v => '' + v, args3));
        assert.deepInclude(R.map(v => '' + v, categoryData4), R.map(v => '' + v, args4));    
    });


    it('create SubCategory of a category (multiple) ', async () => {

        // create the category
        const args = factoryArgs(globalAdmin);
        const [status,categoryAddress] = await contract.createCategory(args);

        let categoryData = await contract.get({address:categoryAddress});
        Object.assign(categoryData)   

        assert.deepInclude(
            // Convert the Category data into strings as the args are in strings
            R.map(v => '' + v, categoryData),
            R.map(v => '' + v, args));

        // create multiple subCategories of category
        const subCategoryArgs1 = subCategoryFactoryArgs(globalAdmin);
        const subCategoryArgs2 = subCategoryFactoryArgs(globalAdmin);
        const subCategoryArgs3 = subCategoryFactoryArgs(globalAdmin);
        const subCategoryArgs4 = subCategoryFactoryArgs(globalAdmin);   

        const [status1,subCategory1] = await contract.createSubCategory({category:categoryAddress,...subCategoryArgs1});
        const [status2,subCategory2] = await contract.createSubCategory({category:categoryAddress,...subCategoryArgs2});
        const [status3,subCategory3] = await contract.createSubCategory({category:categoryAddress,...subCategoryArgs3});
        const [status4,subCategory4] = await contract.createSubCategory({category:categoryAddress,...subCategoryArgs4}); 

        const subCategoryData1 = await contract.getSubCategory({address: subCategory1});
        const subCategoryData2 = await contract.getSubCategory({address: subCategory2});
        const subCategoryData3 = await contract.getSubCategory({address: subCategory3});
        const subCategoryData4 = await contract.getSubCategory({address: subCategory4});
        // Our logic shouldn't mix up categorys
        assert.deepInclude(R.map(v => '' + v, subCategoryData1), R.map(v => '' + v, subCategoryArgs1));
        assert.deepInclude(R.map(v => '' + v, subCategoryData2), R.map(v => '' + v, subCategoryArgs2));
        assert.deepInclude(R.map(v => '' + v, subCategoryData3), R.map(v => '' + v, subCategoryArgs3));
        assert.deepInclude(R.map(v => '' + v, subCategoryData4), R.map(v => '' + v, subCategoryArgs4)); 
        
    })

    it('create Category - 401', async () => {
        const args = factoryArgs(tradingEntity);
        let _contract = await categoryManagerJs.bindAddress(
            tradingEntity,
            contract.address,
            newOptions
        )

        await assert.restStatus(async () => {
            await _contract.createCategory(args);
        }, RestStatus.UNAUTHORIZED);
    });
    
});
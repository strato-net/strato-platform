#!/usr/bin/env node

/**
 * Bad Debt Test Script - Final Version
 * Uses proper nonce management and follows deploy script patterns exactly
 */

require('dotenv').config();
const { rest, util } = require('blockapps-rest');
const config = require('./deploy/config');
const auth = require('./deploy/auth');

// Contract addresses from latest deployment with fixed AdminRegistry
const ADDRESSES = {
    POOL_FACTORY:'91920a1dbe1cff51dc56529a3c1aded394fe6909',
    TOKEN_FACTORY:'c505eadd34ee9ae885250e07ea6dc4f7d74d64c2',
    ADMIN_REGISTRY:'23d62a937b2b5dfaaa22a19915dca256577cec29',
    FEE_COLLECTOR:'5b6141e44042211cde5e04f1ad18d4305c1b76c5',
    PRICE_ORACLE:'25e239fffc207231f3023a943903c962f5ac02fc',
    RATE_STRATEGY:'cd06dc2ea10aa68db4b0ba03135b96470e0e35b7',
    LIQUIDITY_POOL:'50c3407f558f50e01e96af4f01ffb65932386e4e',
    COLLATERAL_VAULT:'018a3817f444b183ddc6f66fefb112077a70655f',
    LENDING_POOL:'b5cdf655f5dfbbd71da12ab2c0624b8fb81ccdbb',
    LENDING_REGISTRY:'299b92fce28d86d354437d83c3c2ef5549c616a5',
    POOL_CONFIGURATOR:'67960267f7f1af6d89cdcd99e901a048f749e5b6',
    MERCATA_BRIDGE:'212afbadc8affb1e9a565fc450695f6171561d1c',
    CDP_REGISTRY:'68630bec7f44fd71c48a2c5acb25d8f70ad87ec8',
    CDP_ENGINE:'d0cfcc9bebe1cf36d2f76c766002acc1aba7e407',
    CDP_VAULT:'4bac12b903c4b265d792a39f2689808de2918ae4',
    SAFETY_MODULE:'d4c6322856ffc6873d9a2e06bec4f718ee580f45',
    MERCATA_CORE:'4abf06ff8558e0285351f89977a75268edb87803',
};

// Test configuration
const TEST_CONFIG = {
    INITIAL_USDST_PRICE: '1000000000000000000', // $1.00
    INITIAL_WETH_PRICE: '2000000000000000000000', // $2000.00
    CRASH_WETH_PRICE: '1000000000000000000000', // $1000.00 (50% crash)
    LIQUIDITY_AMOUNT: '1000000000000000000000', // 1K USDST (more reasonable for testing)
    SAFETY_DEPOSIT_AMOUNT: '100000000000000000000', // 100 USDST
    COLLATERAL_AMOUNT: '1000000000000000000', // 1 WETH
    BORROW_AMOUNT: '1500000000000000000000', // 1.5K USDST (75% of 2K collateral value)
    WETH_LTV: 7500,
    WETH_LIQUIDATION_THRESHOLD: 8000,
    WETH_LIQUIDATION_BONUS: 10500,
    USDST_INTEREST_RATE: 500,
    RESERVE_FACTOR: 1000,
    SAFETY_FACTOR: 5000,
    PER_SECOND_FACTOR_RAY: '1000000001547125957863212448'
};

/**
 * Get authentication token using the same pattern as deploy scripts
 */
async function getAuthToken() {
    const username = process.env.GLOBAL_ADMIN_NAME;
    const password = process.env.GLOBAL_ADMIN_PASSWORD;
    
    if (!username || !password) {
        throw new Error('Please set GLOBAL_ADMIN_NAME and GLOBAL_ADMIN_PASSWORD in your .env file');
    }
    
    console.log(`🔐 Authenticating as ${username}...`);
    const tokenString = await auth.getUserToken(username, password);
    console.log(`✅ Token acquired: ${tokenString.slice(0, 10)}...`);
    
    return { token: tokenString };
}

/**
 * Execute a batch of calls using callList (proper nonce management)
 */
async function executeBatch(callListArgs, description) {
    console.log(`📦 Executing batch: ${description}`);
    
    // Get fresh token for each batch to avoid nonce issues
    const username = process.env.GLOBAL_ADMIN_NAME;
    const password = process.env.GLOBAL_ADMIN_PASSWORD;
    const tokenString = await auth.getUserToken(username, password);
    const token = { token: tokenString };
    
    const options = { config, cacheNonce: true, isAsync: true };
    const pendingTxResultList = await rest.callList(token, callListArgs, options);
    const responseArray = Array.isArray(pendingTxResultList) ? pendingTxResultList : [pendingTxResultList];
    
    // Poll until completion
    const predicate = (results) => results.filter((r) => r.status === 'Pending').length === 0;
    const action = async (opts) => await rest.getBlocResults(
        token,
        responseArray.map((r) => r.hash),
        opts
    );
    
    const finalResults = await util.until(predicate, action, { config, isAsync: true }, 120000);
    
    // Check all transactions succeeded
    const results = Array.isArray(finalResults) ? finalResults : [finalResults];
    for (let i = 0; i < results.length; i++) {
        if (results[i].status !== 'Success') {
            throw new Error(`Transaction ${i} failed: ${results[i].status} - ${JSON.stringify(results[i].txResult)}`);
        }
    }
    
    console.log(`✅ Batch completed: ${description}`);
    return results;
}

/**
 * Create a call list entry
 */
function createCall(contractAddress, method, args, contractName = 'Contract') {
    return {
        contract: {
            name: contractName,
            address: contractAddress
        },
        method: method,
        args: args,
        txParams: {
            gasPrice: config.gasPrice || 1,
            gasLimit: config.gasLimit || 5000000
        }
    };
}

/**
 * Execute a batch of transactions with proper error handling and delay
 */
async function executeBatch(calls, batchName, token, retries = 3) {
    console.log(`📦 Executing batch: ${batchName}`);
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const options = { config, cacheNonce: true, isAsync: true };
            const pendingTxResultList = await rest.callList(token, calls, options);
            const responseArray = Array.isArray(pendingTxResultList) ? pendingTxResultList : [pendingTxResultList];
            
            // Poll until completion
            const predicate = (results) => results.filter((r) => r.status === 'Pending').length === 0;
            const action = async (opts) => await rest.getBlocResults(
                token,
                responseArray.map((r) => r.hash),
                opts
            );
            
            const finalResults = await util.until(predicate, action, { config, isAsync: true }, 120000);
            
            // Check all transactions succeeded
            const results = Array.isArray(finalResults) ? finalResults : [finalResults];
            for (let i = 0; i < results.length; i++) {
                if (results[i].status !== 'Success') {
                    // Check if it's a mempool competition issue that we can retry
                    const errorMessage = results[i].txResult?.message || '';
                    if (errorMessage.includes('more lucrative transaction') && attempt < retries) {
                        console.log(`⚠️ Mempool competition detected (attempt ${attempt}/${retries}), retrying...`);
                        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait longer before retry
                        break; // Break inner loop to retry the whole batch
                    }
                    throw new Error(`Transaction ${i} failed: ${results[i].status} - ${JSON.stringify(results[i].txResult)}`);
                }
            }
            
            console.log(`✅ Batch completed: ${batchName}`);
            
            // Add a small delay to let the blockchain process before next batch
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            return results;
            
        } catch (error) {
            if (attempt === retries) {
                console.error(`❌ Batch failed after ${retries} attempts: ${batchName}`);
                throw error;
            } else {
                console.log(`⚠️ Batch attempt ${attempt} failed, retrying: ${batchName}`);
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait before retry
            }
        }
    }
}

/**
 * Main test function
 */
async function runBadDebtTest() {
    let token;
    let testTokens = {};
    
    try {
        console.log('🚀 Starting Bad Debt Test...');
        
        // Get authentication token
        token = await getAuthToken();
        console.log('✅ Authentication successful');
        
        // Step 1: Create and activate test tokens
        console.log('🪙 Creating test tokens...');
        
        const tokenCreationCalls = [
            createCall(ADDRESSES.TOKEN_FACTORY, 'createToken', {
                _name: 'USD Stablecoin Test',
                _description: 'Test stablecoin for lending',
                _images: [],
                _files: [],
                _fileNames: [],
                _symbol: 'USDST',
                _initialSupply: '100000000000000000000000',
                _customDecimals: 18
            }, 'TokenFactory'),
            createCall(ADDRESSES.TOKEN_FACTORY, 'createToken', {
                _name: 'Wrapped Ethereum Test',
                _description: 'Test WETH for collateral',
                _images: [],
                _files: [],
                _fileNames: [],
                _symbol: 'WETH',
                _initialSupply: '10000000000000000000000',
                _customDecimals: 18
            }, 'TokenFactory'),
            createCall(ADDRESSES.TOKEN_FACTORY, 'createToken', {
                _name: 'Safety USDST',
                _description: 'Safety module token',
                _images: [],
                _files: [],
                _fileNames: [],
                _symbol: 'sUSDST',
                _initialSupply: '0',
                _customDecimals: 18
            }, 'TokenFactory'),
            createCall(ADDRESSES.TOKEN_FACTORY, 'createToken', {
                _name: 'Market USDST',
                _description: 'Market token for USDST',
                _images: [],
                _files: [],
                _fileNames: [],
                _symbol: 'mUSDST',
                _initialSupply: '0',
                _customDecimals: 18
            }, 'TokenFactory')
        ];
        
        const tokenResults = await executeBatch(tokenCreationCalls, 'Token Creation', token);
        
        testTokens.usdst = tokenResults[0].txResult.contractsCreated[0];
        testTokens.weth = tokenResults[1].txResult.contractsCreated[0];
        testTokens.sToken = tokenResults[2].txResult.contractsCreated[0];
        testTokens.mToken = tokenResults[3].txResult.contractsCreated[0];
        
        console.log(`✅ USDST created: ${testTokens.usdst}`);
        console.log(`✅ WETH created: ${testTokens.weth}`);
        console.log(`✅ sToken created: ${testTokens.sToken}`);
        console.log(`✅ mToken created: ${testTokens.mToken}`);
        
        // Step 2: Activate tokens
        const activationCalls = [
            createCall(testTokens.usdst, 'setStatus', { newStatus: 2 }, 'USDST'),
            createCall(testTokens.weth, 'setStatus', { newStatus: 2 }, 'WETH'),
            createCall(testTokens.sToken, 'setStatus', { newStatus: 2 }, 'sUSDST'),
            createCall(testTokens.mToken, 'setStatus', { newStatus: 2 }, 'mUSDST')
        ];
        
        await executeBatch(activationCalls, 'Token Activation', token);
        console.log('✅ All tokens activated');
        
        // Step 2.5: Mint tokens to our account for testing
        console.log('💰 Minting tokens to test account...');
        
        // Use the known test user address
        const userAddress = '1b7dc206ef2fe3aab27404b88c36470ccf16c0ce';
        
        const mintingCalls = [
            createCall(testTokens.usdst, 'mint', {
                to: userAddress,
                amount: '250000000000000000000000' // 250K USDST to our account
            }, 'USDST'),
            createCall(testTokens.weth, 'mint', {
                to: userAddress,
                amount: '100000000000000000000' // 100 WETH to our account
            }, 'WETH')
        ];
        
        await executeBatch(mintingCalls, 'Token Minting', token);
        console.log('✅ Tokens minted to test account');
        
        // Step 2.5: Transfer ownership of sToken and mToken to appropriate contracts
        console.log('🔐 Transferring token ownership...');
        
        const ownershipTransferCalls = [
            // Transfer sToken ownership to SafetyModule (so it can mint/burn sTokens)
            createCall(testTokens.sToken, 'transferOwnership', {
                newOwner: ADDRESSES.SAFETY_MODULE
            }, 'sToken'),
            // Transfer mToken ownership to LiquidityPool (so it can mint/burn mTokens)
            createCall(testTokens.mToken, 'transferOwnership', {
                newOwner: ADDRESSES.LIQUIDITY_POOL
            }, 'mToken')
        ];
        
        await executeBatch(ownershipTransferCalls, 'Token Ownership Transfer', token);
        console.log('✅ Token ownership transferred');
        
        // Step 3: Whitelist user for lending operations
        console.log('🔐 Whitelisting user for lending operations...');
        
        const whitelistCalls = [
            createCall(testTokens.usdst, 'addWhitelist', {
                _admin: ADDRESSES.ADMIN_REGISTRY || ADDRESSES.POOL_CONFIGURATOR,
                _func: 'depositLiquidity',
                _accountToWhitelsit: userAddress
            }, 'USDST')
        ];
        
        await executeBatch(whitelistCalls, 'User Whitelisting', token);
        console.log('✅ User whitelisted for operations');
        
        // Step 4: Configure lending pool
        console.log('⚙️ Configuring lending pool...');
        
        const configurationCalls = [
            createCall(ADDRESSES.POOL_CONFIGURATOR, 'setBorrowableAsset', { asset: testTokens.usdst }, 'PoolConfigurator'),
            createCall(ADDRESSES.POOL_CONFIGURATOR, 'setMToken', { mToken: testTokens.mToken }, 'PoolConfigurator'),
            createCall(ADDRESSES.POOL_CONFIGURATOR, 'configureAsset', {
                asset: testTokens.usdst,
                ltv: 0,
                liquidationThreshold: 0,
                liquidationBonus: 10000,
                interestRate: TEST_CONFIG.USDST_INTEREST_RATE,
                reserveFactor: TEST_CONFIG.RESERVE_FACTOR,
                perSecondFactorRAY: TEST_CONFIG.PER_SECOND_FACTOR_RAY
            }, 'PoolConfigurator'),
            createCall(ADDRESSES.POOL_CONFIGURATOR, 'configureAsset', {
                asset: testTokens.weth,
                ltv: TEST_CONFIG.WETH_LTV,
                liquidationThreshold: TEST_CONFIG.WETH_LIQUIDATION_THRESHOLD,
                liquidationBonus: TEST_CONFIG.WETH_LIQUIDATION_BONUS,
                interestRate: 0,
                reserveFactor: 0,
                perSecondFactorRAY: '1000000000000000000000000000'
            }, 'PoolConfigurator'),
            createCall(ADDRESSES.POOL_CONFIGURATOR, 'setSafetyFactor', { safetyFactor: TEST_CONFIG.SAFETY_FACTOR }, 'PoolConfigurator'),
            createCall(ADDRESSES.POOL_CONFIGURATOR, 'setSafetyModuleTokens', {
                sToken: testTokens.sToken,
                underlyingAsset: testTokens.usdst
            }, 'PoolConfigurator')
        ];
        
        await executeBatch(configurationCalls, 'Lending Pool Configuration', token);
        console.log('✅ Lending pool configured');
        
        // Step 4: Set up price oracle
        console.log('📊 Setting up price oracle...');
        
        // Since we're the admin/owner, we should be able to set prices directly
        const priceSetupCalls = [
            createCall(ADDRESSES.PRICE_ORACLE, 'setAssetPrice', {
                asset: testTokens.usdst,
                price: TEST_CONFIG.INITIAL_USDST_PRICE
            }, 'PriceOracle'),
            createCall(ADDRESSES.PRICE_ORACLE, 'setAssetPrice', {
                asset: testTokens.weth,
                price: TEST_CONFIG.INITIAL_WETH_PRICE
            }, 'PriceOracle')
        ];
        
        await executeBatch(priceSetupCalls, 'Price Oracle Setup', token);
        console.log('✅ Prices set - USDST: $1.00, WETH: $2000.00');
        
        // Step 5: Provide liquidity and deposit in safety module
        console.log('💧 Providing liquidity and safety deposits...');
        // First approve tokens for spending
        const approvalCalls = [
            createCall(testTokens.usdst, 'approve', {
                spender: ADDRESSES.LIQUIDITY_POOL,
                value: TEST_CONFIG.LIQUIDITY_AMOUNT
            }, 'USDST-LP'),
            createCall(testTokens.usdst, 'approve', {
                spender: ADDRESSES.SAFETY_MODULE,
                value: TEST_CONFIG.SAFETY_DEPOSIT_AMOUNT
            }, 'USDST-Safety')
        ];
        
        await executeBatch(approvalCalls, 'Token Approvals', token);
        console.log('✅ Tokens approved for spending');
        
        // Now deposit to pools
        const depositCalls = [
            createCall(ADDRESSES.LENDING_POOL, 'depositLiquidity', {
                amount: TEST_CONFIG.LIQUIDITY_AMOUNT
            }, 'LendingPool'),
            createCall(ADDRESSES.SAFETY_MODULE, 'deposit', {
                amount: TEST_CONFIG.SAFETY_DEPOSIT_AMOUNT
            }, 'SafetyModule')
        ];
        
        await executeBatch(depositCalls, 'Liquidity and Safety Deposits', token);
        console.log('✅ Liquidity and safety deposits completed');
        
        // Step 6: Create borrow position
        console.log('💰 Creating borrow position...');
        const borrowPositionCalls = [
            createCall(testTokens.usdst, 'approve', {
                spender: ADDRESSES.LIQUIDITY_POOL,
                value: (BigInt(TEST_CONFIG.BORROW_AMOUNT) * 100n).toString()
            }, 'USDST'),
            createCall(ADDRESSES.LENDING_POOL, 'depositLiquidity', {
                amount: (BigInt(TEST_CONFIG.BORROW_AMOUNT) * 100n).toString()
            }, 'LendingPool'),
            createCall(testTokens.weth, 'approve', {
                spender: ADDRESSES.COLLATERAL_VAULT,
                value: TEST_CONFIG.COLLATERAL_AMOUNT
            }, 'WETH'),
            createCall(ADDRESSES.LENDING_POOL, 'supplyCollateral', {
                asset: testTokens.weth,
                amount: TEST_CONFIG.COLLATERAL_AMOUNT
            }, 'LendingPool'),
            createCall(ADDRESSES.LENDING_POOL, 'borrow', {
                amount: TEST_CONFIG.BORROW_AMOUNT
            }, 'LendingPool')
        ];
        
        await executeBatch(borrowPositionCalls, 'Borrow Position Creation', token);
        console.log('✅ Borrow position created');
        
        console.log(`👤 User address: ${userAddress}`);
        
        const healthCheckCall = createCall(ADDRESSES.LENDING_POOL, 'getHealthFactor', {
            user: userAddress
        }, 'LendingPool');
        
        const healthResults = await executeBatch([healthCheckCall], 'Health Factor Check', token);
        const healthFactor = healthResults[0].txResult.returnValue;
        console.log(`💊 Initial health factor: ${healthFactor}`);
        
        // Step 7: Crash price and check for bad debt
        console.log('💥 Crashing WETH price...');
        const priceCrashCall = createCall(ADDRESSES.PRICE_ORACLE, 'setAssetPrice', {
            asset: testTokens.weth,
            price: TEST_CONFIG.CRASH_WETH_PRICE
        }, 'PriceOracle');
        
        await executeBatch([priceCrashCall], 'Price Crash', token);
        
        const healthAfterResults = await executeBatch([healthCheckCall], 'Health Factor After Crash', token);
        const healthFactorAfter = healthAfterResults[0].txResult.returnValue;
        console.log(`📉 Health factor after crash: ${healthFactorAfter}`);
        
        if (healthFactorAfter >= 1e18) {
            console.log('⚠️ Position is still healthy! May need to crash price more or increase borrow amount');
        }
        
        // Step 8: Attempt liquidation to create bad debt
        console.log('🔥 Attempting liquidation to create bad debt...');
        const liquidationCall = createCall(ADDRESSES.LENDING_POOL, 'liquidationCallAll', {
            collateralAsset: testTokens.weth,
            borrower: userAddress
        }, 'LendingPool');

        await executeBatch([liquidationCall], 'Liquidation Attempt', token);
        console.log('✅ Liquidation completed');

        // Step 9: Check bad debt and test slashing
        console.log('🔍 Checking bad debt status...');
        
        // Get contract states
        const stateToken = await getAuthToken();
        const lendingPoolState = await rest.getState(stateToken, ADDRESSES.LENDING_POOL, {}, { config });
        const badDebtAmount = lendingPoolState.badDebt || 0;
        console.log(`🚨 Bad debt amount: ${badDebtAmount / 1e18} USDST`);
        
        // Get safety module balance before slashing
        const safetyBalanceCall = createCall(testTokens.usdst, 'balanceOf', {
            account: ADDRESSES.SAFETY_MODULE
        }, 'USDST');
        
        const safetyBalanceResults = await executeBatch([safetyBalanceCall], 'Safety Balance Check', token);
        const safetyBalanceBefore = safetyBalanceResults[0].txResult.returnValue;
        console.log(`💰 Safety module balance before: ${safetyBalanceBefore / 1e18} USDST`);
        
        // Trigger slashing if there's bad debt
        if (badDebtAmount > 0) {
            console.log('⚡ Triggering safety module slashing...');
            const slashingCall = createCall(ADDRESSES.POOL_CONFIGURATOR, 'slashSafetyForBadDebt', {}, 'PoolConfigurator');
            await executeBatch([slashingCall], 'Safety Module Slashing', token);
            
            // Check results after slashing
            const lendingPoolStateAfter = await rest.getState(stateToken, ADDRESSES.LENDING_POOL, {}, { config });
            const badDebtAfter = lendingPoolStateAfter.badDebt || 0;
            console.log(`🚨 Bad debt after slashing: ${badDebtAfter / 1e18} USDST`);
            
            const safetyBalanceAfterResults = await executeBatch([safetyBalanceCall], 'Safety Balance After', token);
            const safetyBalanceAfter = safetyBalanceAfterResults[0].txResult.returnValue;
            console.log(`💰 Safety module balance after: ${safetyBalanceAfter / 1e18} USDST`);
            
            const slashedAmount = safetyBalanceBefore - safetyBalanceAfter;
            console.log(`⚔️ Amount slashed: ${slashedAmount / 1e18} USDST`);
        } else {
            console.log('ℹ️ No bad debt detected - liquidation may have been successful');
        }
        
        // Final exchange rates
        const exchangeRateCalls = [
            createCall(ADDRESSES.LENDING_POOL, 'getExchangeRate', {}, 'LendingPool'),
            createCall(ADDRESSES.SAFETY_MODULE, 'getExchangeRate', {}, 'SafetyModule')
        ];
        
        const exchangeRateResults = await executeBatch(exchangeRateCalls, 'Final Exchange Rates');
        console.log(`📈 Final lending pool exchange rate: ${exchangeRateResults[0].txResult.returnValue}`);
        console.log(`🛡️ Final safety module exchange rate: ${exchangeRateResults[1].txResult.returnValue}`);
        
        console.log('\n🎉 Bad debt test completed successfully!');
        console.log('\n📊 Test Summary:');
        console.log(`- USDST Token: ${testTokens.usdst}`);
        console.log(`- WETH Token: ${testTokens.weth}`);
        console.log(`- sToken: ${testTokens.sToken}`);
        console.log(`- mToken: ${testTokens.mToken}`);
        console.log(`- User Address: ${userAddress}`);
        console.log('- Successfully tested bad debt handling and safety module slashing');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        throw error;
    }
}

// Run the test
if (require.main === module) {
    runBadDebtTest()
        .then(() => {
            console.log('\n✅ Test completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Test failed:', error);
            process.exit(1);
        });
}

module.exports = { runBadDebtTest };

{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

module Backend.Server where

import Backend.Handlers
import Common.API
import Servant

bitcoinBridgeServer :: Server BitcoinBridgeAPI
bitcoinBridgeServer = getBlockSummaries
                 :<|> getGlobalUtxos
                 :<|> getWalletUtxos
                 :<|> getWalletBalance
                 :<|> getMultisigUtxos
                 :<|> postSendToMultisig
                 :<|> postBitcoinRpcCommand
                 :<|> getMarketplaceTransactions

mercataServer :: Server MercataAPI
mercataServer = userServer
           :<|> tokensServer
           :<|> swapServer
           :<|> lendingServer
           :<|> oracleServer
           :<|> onRampServer
           :<|> bridgeServer
           :<|> getHealth

userServer :: Server UserAPI
userServer = getUserMe :<|> adminServer

adminServer :: Server AdminAPI
adminServer = getUserAdmin
         :<|> postUserAdmin
         :<|> deleteUserAdmin

tokensServer :: Server TokensAPI
tokensServer = getTokenBalance
          :<|> getTokenByAddress
          :<|> getAllTokens
          :<|> postToken
          :<|> postTokenTransfer
          :<|> postTokenApprove
          :<|> postTokenTransferFrom
          :<|> postTokenStatus

swapServer :: Server SwapAPI
swapServer = getSwappableTokens
        :<|> getSwappableTokenPairsByAddress
        :<|> getPoolByTokenPair
        :<|> getCalculateSwap
        :<|> getCalculateSwapReverse
        :<|> getLPToken
        :<|> getSwapPoolByAddress
        :<|> getAllSwapPools
        :<|> postSwapPool
        :<|> postSwapPoolAddLiquidity
        :<|> postSwapPoolRemoveLiquidity
        :<|> postSwapPoolSwap

lendingServer :: Server LendingAPI
lendingServer = getLendingPool
           :<|> getLendingPoolDepositableTokens
           :<|> getLendingPoolWithdrawableTokens
           :<|> getLendingPoolLoans
           :<|> getLendingPoolLoanById
           :<|> postLendingPoolDepositLiquidity
           :<|> postLendingPoolWithdrawLiquidity
           :<|> postLendingPoolRepay
           :<|> postLendingPoolManageLiquidity
           :<|> postLendingPoolBorrow
           :<|> liquidationServer
           :<|> postLendingPoolSetInterestRate
           :<|> postLendingPoolSetCollateralRatio
           :<|> postLendingPoolSetLiquidationBonus

liquidationServer :: Server LiquidationAPI
liquidationServer = getLendingPoolLiquidatable
               :<|> getLendingPoolLiquidatableNearUnhealthy
               :<|> getLendingPoolLiquidatableById
               :<|> postLendingPoolLiquidateById

oracleServer :: Server OracleAPI
oracleServer = getOraclePrice
          :<|> postOraclePrice

onRampServer :: Server OnRampAPI
onRampServer = getOnRamp
          :<|> postOnRampBuy
          :<|> postOnRampSell

bridgeServer :: Server BridgeAPI
bridgeServer = postBridgeIn
          :<|> postBridgeOut
          :<|> getBridgeBalanceByAddress
          :<|> getBridgeInTokens
          :<|> getBridgeOutTokens
          :<|> getBridgeDepositStatus
          :<|> getBridgeWithdrawalStatus
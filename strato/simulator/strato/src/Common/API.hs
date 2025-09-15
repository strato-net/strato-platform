{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}

module Common.API where

import Common.Types
import Data.Aeson (Value)
import Data.Text (Text)
import Servant

type GetBlockSummaries = "bitcoin" :> "blocks" :> Get '[JSON] [BitcoinBlockSummary]
type GetGlobalUtxos = "bitcoin" :> "utxos" :> Get '[JSON] [UtxoSummary]
type GetWalletUtxos = "bitcoin" :> "wallet" :> Get '[JSON] [UtxoSummary]
type GetWalletBalance = "bitcoin" :> "wallet" :> "balance" :> Get '[JSON] Double
type GetMultisigUtxos = "bitcoin" :> "bridge" :> Capture "address" Text :> Get '[JSON] [UtxoSummary]
type PostSendToMultisig = "bitcoin" :> "bridge" :> ReqBody '[JSON] PostSendToMultisigArgs :> Post '[JSON] Text
type PostBitcoinRpcCommand = "bitcoin" :> "rpc" :> ReqBody '[JSON] RpcCommand :> Post '[JSON] Value
type GetMarketplaceTransactions = "marketplace" :> "transactions" :> Get '[JSON] [Transaction]

type BitcoinBridgeAPI = "bitcoin" :>
       (    GetBlockSummaries
       :<|> GetGlobalUtxos
       :<|> GetWalletUtxos
       :<|> GetWalletBalance
       :<|> GetMultisigUtxos
       :<|> PostSendToMultisig
       :<|> PostBitcoinRpcCommand
       :<|> GetMarketplaceTransactions
       )

type MercataAPI = "api" :>
       (    "user" :> UserAPI
       :<|> "tokens" :> TokensAPI
       :<|> "swap" :> SwapAPI
       :<|> "lend" :> LendingAPI
       :<|> "oracle" :> "price" :> OracleAPI
       :<|> "onramp" :> OnRampAPI
       :<|> "bridge" :> BridgeAPI
       :<|> "health" :> GetHealth
       )

type UserAPI = GetUserMe
          :<|> AdminAPI

type GetUserMe = "me" :> Get '[JSON] Value

type AdminAPI = GetUserAdmin
           :<|> PostUserAdmin
           :<|> DeleteUserAdmin

type GetUserAdmin = "admin" :> Get '[JSON] Value
type PostUserAdmin = "admin" :> ReqBody '[JSON] Value :> Post '[JSON] Value
type DeleteUserAdmin = "admin" :> ReqBody '[JSON] Value :> Delete '[JSON] Value

type TokensAPI = GetTokenBalance
            :<|> GetTokenByAddress
            :<|> GetAllTokens
            :<|> PostToken
            :<|> PostTokenTransfer
            :<|> PostTokenApprove
            :<|> PostTokenTransferFrom
            :<|> PostTokenStatus

type GetTokenBalance = "balance" :> Get '[JSON] Value
type GetTokenByAddress = Capture "address" Text :> Get '[JSON] Value
type GetAllTokens = Get '[JSON] Value
type PostToken = ReqBody '[JSON] Value :> Post '[JSON] Value
type PostTokenTransfer = "transfer" :> ReqBody '[JSON] Value :> Post '[JSON] Value
type PostTokenApprove = "approve" :> ReqBody '[JSON] Value :> Post '[JSON] Value
type PostTokenTransferFrom = "transferFrom" :> ReqBody '[JSON] Value :> Post '[JSON] Value
type PostTokenStatus = "setStatus" :> ReqBody '[JSON] Value :> Post '[JSON] Value

type SwapAPI = GetSwappableTokens
          :<|> GetSwappableTokenPairsByAddress
          :<|> GetPoolByTokenPair
          :<|> GetCalculateSwap
          :<|> GetCalculateSwapReverse
          :<|> GetLPToken
          :<|> GetSwapPoolByAddress
          :<|> GetAllSwapPools
          :<|> PostSwapPool
          :<|> PostSwapPoolAddLiquidity
          :<|> PostSwapPoolRemoveLiquidity
          :<|> PostSwapPoolSwap

type GetSwappableTokens = "swappableTokens" :> Get '[JSON] Value
type GetSwappableTokenPairsByAddress = "swappableTokenPairs" :> Capture "address" Text :> Get '[JSON] Value
type GetPoolByTokenPair = "poolByTokenPair" :> Get '[JSON] Value
type GetCalculateSwap = "calculateSwap" :> Get '[JSON] Value
type GetCalculateSwapReverse = "calculateSwapReverse" :> Get '[JSON] Value
type GetLPToken = "lpToken" :> Get '[JSON] Value
type GetSwapPoolByAddress = Capture "address" Text :> Get '[JSON] Value
type GetAllSwapPools = Get '[JSON] Value
type PostSwapPool = ReqBody '[JSON] Value :> Post '[JSON] Value
type PostSwapPoolAddLiquidity = "addLiquidity" :> ReqBody '[JSON] Value :> Post '[JSON] Value
type PostSwapPoolRemoveLiquidity = "removeLiquidity" :> ReqBody '[JSON] Value :> Post '[JSON] Value 
type PostSwapPoolSwap = "swap" :> ReqBody '[JSON] Value :> Post '[JSON] Value 

type LendingAPI = GetLendingPool
             :<|> GetLendingPoolDepositableTokens
             :<|> GetLendingPoolWithdrawableTokens
             :<|> GetLendingPoolLoans
             :<|> GetLendingPoolLoanById
             :<|> PostLendingPoolDepositLiquidity
             :<|> PostLendingPoolWithdrawLiquidity
             :<|> PostLendingPoolRepay
             :<|> PostLendingPoolManageLiquidity
             :<|> PostLendingPoolBorrow
             :<|> "liquidation" :> LiquidationAPI
             :<|> PostLendingPoolSetInterestRate
             :<|> PostLendingPoolSetCollateralRatio
             :<|> PostLendingPoolSetLiquidationBonus

type GetLendingPool = Get '[JSON] Value
type GetLendingPoolDepositableTokens = "depositableTokens" :> Get '[JSON] Value
type GetLendingPoolWithdrawableTokens = "withdrawableTokens" :> Get '[JSON] Value
type GetLendingPoolLoans = "loans" :> Get '[JSON] Value
type GetLendingPoolLoanById = "loans" :> Capture "id" Text :> Get '[JSON] Value
type PostLendingPoolDepositLiquidity = "depositLiquidity" :> ReqBody '[JSON] Value :> Post '[JSON] Value
type PostLendingPoolWithdrawLiquidity = "withdrawLiquidity" :> ReqBody '[JSON] Value :> Post '[JSON] Value
type PostLendingPoolRepay = "repay" :> ReqBody '[JSON] Value :> Post '[JSON] Value
type PostLendingPoolManageLiquidity = "manageLiquidity" :> ReqBody '[JSON] Value :> Post '[JSON] Value
type PostLendingPoolBorrow = "borrow" :> ReqBody '[JSON] Value :> Post '[JSON] Value
type PostLendingPoolSetInterestRate = "setInterestRate" :> ReqBody '[JSON] Value :> Post '[JSON] Value
type PostLendingPoolSetCollateralRatio = "setCollateralRatio" :> ReqBody '[JSON] Value :> Post '[JSON] Value
type PostLendingPoolSetLiquidationBonus = "setLiquidiationBonus" :> ReqBody '[JSON] Value :> Post '[JSON] Value

type LiquidationAPI = GetLendingPoolLiquidatable
                 :<|> GetLendingPoolLiquidatableNearUnhealthy
                 :<|> GetLendingPoolLiquidatableById
                 :<|> PostLendingPoolLiquidateById

type GetLendingPoolLiquidatable = Get '[JSON] Value
type GetLendingPoolLiquidatableNearUnhealthy = "near-unhealthy" :> Get '[JSON] Value
type GetLendingPoolLiquidatableById = Capture "id" Text :> Get '[JSON] Value
type PostLendingPoolLiquidateById = Capture "id" Text :> ReqBody '[JSON] Value :> Post '[JSON] Value

type OracleAPI = GetOraclePrice
            :<|> PostOraclePrice

type GetOraclePrice = Get '[JSON] Value
type PostOraclePrice = ReqBody '[JSON] Value :> Post '[JSON] Value

type OnRampAPI = GetOnRamp
            :<|> PostOnRampBuy
            :<|> PostOnRampSell

type GetOnRamp = Get '[JSON] Value
type PostOnRampBuy = "buy" :> ReqBody '[JSON] Value :> Post '[JSON] Value
type PostOnRampSell = "sell" :> ReqBody '[JSON] Value :> Post '[JSON] Value

type BridgeAPI = PostBridgeIn
            :<|> PostBridgeOut
            :<|> GetBridgeBalanceByAddress
            :<|> GetBridgeInTokens
            :<|> GetBridgeOutTokens
            :<|> GetBridgeDepositStatus
            :<|> GetBridgeWithdrawalStatus

type PostBridgeIn = "bridgeIn" :> ReqBody '[JSON] Value :> Post '[JSON] Value
type PostBridgeOut = "bridgeOut" :> ReqBody '[JSON] Value :> Post '[JSON] Value
type GetBridgeBalanceByAddress = "balance" :> Capture "tokenAddress" Text :> Get '[JSON] Value
type GetBridgeInTokens = "bridgeInTokens" :> Get '[JSON] Value
type GetBridgeOutTokens = "bridgeOutTokens" :> Get '[JSON] Value
type GetBridgeDepositStatus = "depositStatus" :> Capture "status" Text :> Get '[JSON] Value
type GetBridgeWithdrawalStatus = "withdrawalStatus" :> Capture "status" Text :> Get '[JSON] Value

type GetHealth = Get '[JSON] Value
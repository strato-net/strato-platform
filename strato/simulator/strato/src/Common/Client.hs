{-# LANGUAGE TypeApplications #-}

module Common.Client where

import Common.API
import Servant
import Servant.Client

getBlockSummaries :: Client ClientM GetBlockSummaries
getBlockSummaries = client (Proxy @GetBlockSummaries)

getGlobalUtxos :: Client ClientM GetGlobalUtxos
getGlobalUtxos = client (Proxy @GetGlobalUtxos)

getWalletUtxos :: Client ClientM GetWalletUtxos
getWalletUtxos = client (Proxy @GetWalletUtxos)

getWalletBalance :: Client ClientM GetWalletBalance
getWalletBalance = client (Proxy @GetWalletBalance)

getMultisigUtxos :: Client ClientM GetMultisigUtxos
getMultisigUtxos = client (Proxy @GetMultisigUtxos)

postSendToMultisig :: Client ClientM PostSendToMultisig
postSendToMultisig = client (Proxy @PostSendToMultisig)

postBitcoinRpcCommand :: Client ClientM PostBitcoinRpcCommand
postBitcoinRpcCommand = client (Proxy @PostBitcoinRpcCommand)

getMarketplaceTransactions :: Client ClientM GetMarketplaceTransactions
getMarketplaceTransactions = client (Proxy :: Proxy GetMarketplaceTransactions)

getUserMe :: Client ClientM GetUserMe
getUserMe = client (Proxy :: Proxy GetUserMe)

getUserAdmin :: Client ClientM GetUserAdmin
getUserAdmin = client (Proxy :: Proxy GetUserAdmin)

postUserAdmin :: Client ClientM PostUserAdmin
postUserAdmin = client (Proxy :: Proxy PostUserAdmin)

deleteUserAdmin :: Client ClientM DeleteUserAdmin
deleteUserAdmin = client (Proxy :: Proxy DeleteUserAdmin)

getTokenBalance :: Client ClientM GetTokenBalance
getTokenBalance = client (Proxy :: Proxy GetTokenBalance)

getTokenByAddress :: Client ClientM GetTokenByAddress
getTokenByAddress = client (Proxy :: Proxy GetTokenByAddress)

getAllTokens :: Client ClientM GetAllTokens
getAllTokens = client (Proxy :: Proxy GetAllTokens)

postToken :: Client ClientM PostToken
postToken = client (Proxy :: Proxy PostToken)

postTokenTransfer :: Client ClientM PostTokenTransfer
postTokenTransfer = client (Proxy :: Proxy PostTokenTransfer)

postTokenApprove :: Client ClientM PostTokenApprove
postTokenApprove = client (Proxy :: Proxy PostTokenApprove)

postTokenTransferFrom :: Client ClientM PostTokenTransferFrom
postTokenTransferFrom = client (Proxy :: Proxy PostTokenTransferFrom)

postTokenStatus :: Client ClientM PostTokenStatus
postTokenStatus = client (Proxy :: Proxy PostTokenStatus)

getSwappableTokens :: Client ClientM GetSwappableTokens
getSwappableTokens = client (Proxy :: Proxy GetSwappableTokens)

getSwappableTokenPairsByAddress :: Client ClientM GetSwappableTokenPairsByAddress
getSwappableTokenPairsByAddress = client (Proxy :: Proxy GetSwappableTokenPairsByAddress)

getPoolByTokenPair :: Client ClientM GetPoolByTokenPair
getPoolByTokenPair = client (Proxy :: Proxy GetPoolByTokenPair)

getCalculateSwap :: Client ClientM GetCalculateSwap
getCalculateSwap = client (Proxy :: Proxy GetCalculateSwap)

getCalculateSwapReverse :: Client ClientM GetCalculateSwapReverse
getCalculateSwapReverse = client (Proxy :: Proxy GetCalculateSwapReverse)

getLPToken :: Client ClientM GetLPToken
getLPToken = client (Proxy :: Proxy GetLPToken)

getSwapPoolByAddress :: Client ClientM GetSwapPoolByAddress
getSwapPoolByAddress = client (Proxy :: Proxy GetSwapPoolByAddress)

getAllSwapPools :: Client ClientM GetAllSwapPools
getAllSwapPools = client (Proxy :: Proxy GetAllSwapPools)

postSwapPool :: Client ClientM PostSwapPool
postSwapPool = client (Proxy :: Proxy PostSwapPool)

postSwapPoolAddLiquidity :: Client ClientM PostSwapPoolAddLiquidity
postSwapPoolAddLiquidity = client (Proxy :: Proxy PostSwapPoolAddLiquidity)

postSwapPoolRemoveLiquidity :: Client ClientM PostSwapPoolRemoveLiquidity
postSwapPoolRemoveLiquidity = client (Proxy :: Proxy PostSwapPoolRemoveLiquidity)

postSwapPoolSwap :: Client ClientM PostSwapPoolSwap
postSwapPoolSwap = client (Proxy :: Proxy PostSwapPoolSwap)

getLendingPool :: Client ClientM GetLendingPool
getLendingPool = client (Proxy :: Proxy GetLendingPool)

getLendingPoolDepositableTokens :: Client ClientM GetLendingPoolDepositableTokens
getLendingPoolDepositableTokens = client (Proxy :: Proxy GetLendingPoolDepositableTokens)

getLendingPoolWithdrawableTokens :: Client ClientM GetLendingPoolWithdrawableTokens
getLendingPoolWithdrawableTokens = client (Proxy :: Proxy GetLendingPoolWithdrawableTokens)

getLendingPoolLoans :: Client ClientM GetLendingPoolLoans
getLendingPoolLoans = client (Proxy :: Proxy GetLendingPoolLoans)

getLendingPoolLoanById :: Client ClientM GetLendingPoolLoanById
getLendingPoolLoanById = client (Proxy :: Proxy GetLendingPoolLoanById)

postLendingPoolDepositLiquidity :: Client ClientM PostLendingPoolDepositLiquidity
postLendingPoolDepositLiquidity = client (Proxy :: Proxy PostLendingPoolDepositLiquidity)

postLendingPoolWithdrawLiquidity :: Client ClientM PostLendingPoolWithdrawLiquidity
postLendingPoolWithdrawLiquidity = client (Proxy :: Proxy PostLendingPoolWithdrawLiquidity)

postLendingPoolRepay :: Client ClientM PostLendingPoolRepay
postLendingPoolRepay = client (Proxy :: Proxy PostLendingPoolRepay)

postLendingPoolManageLiquidity :: Client ClientM PostLendingPoolManageLiquidity
postLendingPoolManageLiquidity = client (Proxy :: Proxy PostLendingPoolManageLiquidity)

postLendingPoolBorrow :: Client ClientM PostLendingPoolBorrow
postLendingPoolBorrow = client (Proxy :: Proxy PostLendingPoolBorrow)

postLendingPoolSetInterestRate :: Client ClientM PostLendingPoolSetInterestRate
postLendingPoolSetInterestRate = client (Proxy :: Proxy PostLendingPoolSetInterestRate)

postLendingPoolSetCollateralRatio :: Client ClientM PostLendingPoolSetCollateralRatio
postLendingPoolSetCollateralRatio = client (Proxy :: Proxy PostLendingPoolSetCollateralRatio)

postLendingPoolSetLiquidationBonus :: Client ClientM PostLendingPoolSetLiquidationBonus
postLendingPoolSetLiquidationBonus = client (Proxy :: Proxy PostLendingPoolSetLiquidationBonus)

getLendingPoolLiquidatable :: Client ClientM GetLendingPoolLiquidatable
getLendingPoolLiquidatable = client (Proxy :: Proxy GetLendingPoolLiquidatable)

getLendingPoolLiquidatableNearUnhealthy :: Client ClientM GetLendingPoolLiquidatableNearUnhealthy
getLendingPoolLiquidatableNearUnhealthy = client (Proxy :: Proxy GetLendingPoolLiquidatableNearUnhealthy)

getLendingPoolLiquidatableById :: Client ClientM GetLendingPoolLiquidatableById
getLendingPoolLiquidatableById = client (Proxy :: Proxy GetLendingPoolLiquidatableById)

postLendingPoolLiquidateById :: Client ClientM PostLendingPoolLiquidateById
postLendingPoolLiquidateById = client (Proxy :: Proxy PostLendingPoolLiquidateById)

getOraclePrice :: Client ClientM GetOraclePrice
getOraclePrice = client (Proxy :: Proxy GetOraclePrice)

postOraclePrice :: Client ClientM PostOraclePrice
postOraclePrice = client (Proxy :: Proxy PostOraclePrice)

getOnRamp :: Client ClientM GetOnRamp
getOnRamp = client (Proxy :: Proxy GetOnRamp)

postOnRampBuy :: Client ClientM PostOnRampBuy
postOnRampBuy = client (Proxy :: Proxy PostOnRampBuy)

postOnRampSell :: Client ClientM PostOnRampSell
postOnRampSell = client (Proxy :: Proxy PostOnRampSell)

postBridgeIn :: Client ClientM PostBridgeIn
postBridgeIn = client (Proxy :: Proxy PostBridgeIn)

postBridgeOut :: Client ClientM PostBridgeOut
postBridgeOut = client (Proxy :: Proxy PostBridgeOut)

getBridgeBalanceByAddress :: Client ClientM GetBridgeBalanceByAddress
getBridgeBalanceByAddress = client (Proxy :: Proxy GetBridgeBalanceByAddress)

getBridgeInTokens :: Client ClientM GetBridgeInTokens
getBridgeInTokens = client (Proxy :: Proxy GetBridgeInTokens)

getBridgeOutTokens :: Client ClientM GetBridgeOutTokens
getBridgeOutTokens = client (Proxy :: Proxy GetBridgeOutTokens)

getBridgeDepositStatus :: Client ClientM GetBridgeDepositStatus
getBridgeDepositStatus = client (Proxy :: Proxy GetBridgeDepositStatus)

getBridgeWithdrawalStatus :: Client ClientM GetBridgeWithdrawalStatus
getBridgeWithdrawalStatus = client (Proxy :: Proxy GetBridgeWithdrawalStatus)

getHealth :: Client ClientM GetHealth
getHealth = client (Proxy :: Proxy GetHealth)
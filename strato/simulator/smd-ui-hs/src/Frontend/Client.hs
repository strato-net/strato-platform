{-# LANGUAGE TypeApplications #-}

module Frontend.Client where

import Backend.API
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
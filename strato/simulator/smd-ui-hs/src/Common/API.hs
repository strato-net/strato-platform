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

type BitcoinBridgeAPI = GetBlockSummaries
                   :<|> GetGlobalUtxos
                   :<|> GetWalletUtxos
                   :<|> GetWalletBalance
                   :<|> GetMultisigUtxos
                   :<|> PostSendToMultisig
                   :<|> PostBitcoinRpcCommand
                   :<|> GetMarketplaceTransactions
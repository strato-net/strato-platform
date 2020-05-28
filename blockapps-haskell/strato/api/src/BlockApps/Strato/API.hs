{-# LANGUAGE DataKinds     #-}
{-# LANGUAGE TypeOperators #-}

module BlockApps.Strato.API
   ( API
   )
where

import           BlockApps.Strato.Types
import           Numeric.Natural
import           Servant.API

type API =
  "transaction"
    :> QueryParam "from" Address
    :> QueryParam "to" Address
    :> QueryParam "address" Address
    :> QueryParam "value" Natural
    :> QueryParam "maxvalue" Natural
    :> QueryParam "minvalue" Natural
    :> QueryParam "gasprice" Natural
    :> QueryParam "maxgasprice" Natural
    :> QueryParam "mingasprice" Natural
    :> QueryParam "gaslimit" Natural
    :> QueryParam "maxgaslimit" Natural
    :> QueryParam "mingaslimit" Natural
    :> QueryParam "blocknumber" Natural
    :> QueryParam "hash" Keccak256
    :> QueryParam "chainid" ChainId
    :> Get '[JSON] [WithNext Transaction]
  :<|> "transaction"
    :> "last"
    :> Capture "integer" Natural
    :> QueryParam "chainid" ChainId
    :> Get '[JSON] [WithNext Transaction]
  :<|> "transaction"
    :> ReqBody '[JSON] PostTransaction
    :> Post '[PlainText] Keccak256
  :<|> "transactionList"
      :> ReqBody '[JSON] [PostTransaction]
      :> Post '[JSON] [Keccak256]
  :<|> "transactionResult"
    :> Capture "hash" Keccak256
    :> Get '[JSON] [TransactionResult]
  :<|> "transactionResult"
    :> "batch"
    :> ReqBody '[PlainText] [Keccak256]
    :> Post '[JSON] BatchTransactionResult
  :<|> "block"
    :> QueryParam "number" Natural
    :> QueryParam "minnumber" Natural
    :> QueryParam "maxnumber" Natural
    :> QueryParam "gaslim" Natural
    :> QueryParam "mingaslim" Natural
    :> QueryParam "maxgaslim" Natural
    :> QueryParam "gasused" Natural
    :> QueryParam "mingasused" Natural
    :> QueryParam "maxgasused" Natural
    :> QueryParam "diff" Natural
    :> QueryParam "mindiff" Natural
    :> QueryParam "maxdiff" Natural
    :> QueryParam "txaddress" Address
    :> QueryParam "address" Address
    :> QueryParam "coinbase" Address
    :> QueryParam "hash" Keccak256
    :> QueryParam "chainid" ChainId
    :> Get '[JSON] [WithNext Block]
  :<|> "block"
    :> "last"
    :> Capture "integer" Natural
    :> QueryParam "chainid" ChainId
    :> Get '[JSON] [WithNext Block]
  :<|> "account"
    :> QueryParam "address" Address
    :> QueryParam "balance" Natural
    :> QueryParam "minbalance" Natural
    :> QueryParam "maxbalance" Natural
    :> QueryParam "nonce" Natural
    :> QueryParam "minnonce" Natural
    :> QueryParam "maxnonce" Natural
    :> QueryParams "chainid" ChainId
    :> Get '[JSON] [Account]
  :<|> "stats"
    :> "difficulty"
    :> Get '[JSON] Difficulty
  :<|> "stats"
    :> "totaltx"
    :> Get '[JSON] TxCount
  :<|> "storage"
    :> QueryParam "address" Address
    :> QueryParam "key" Natural
    :> QueryParam "minkey" Natural
    :> QueryParam "maxkey" Natural
    :> QueryParam "value" Natural
    :> QueryParam "minvalue" Natural
    :> QueryParam "maxvalue" Natural
    :> QueryParams "chainid" ChainId
    :> Get '[JSON] [Storage]
  :<|> "faucet"
    :> ReqBody '[FormUrlEncoded] Address
    :> Post '[JSON] [Keccak256]
  :<|> "chain"
    :> ReqBody '[JSON] ChainInfo
    :> Post '[JSON] ChainId
  :<|> "chain"
    :> QueryParams "chainid" ChainId
    :> Get '[JSON] [ChainIdChainInfo]
  :<|> "chains"
    :> ReqBody '[JSON] [ChainInfo]
    :> Post '[JSON] [ChainId]

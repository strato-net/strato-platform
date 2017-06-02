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
  "eth":> "v1.2" :> "transaction"
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
    :> Get '[JSON] [WithNext Transaction]
  :<|> "eth":> "v1.2" :> "transaction"
    :> "last"
    :> Capture "integer" Natural
    :> Get '[JSON] [WithNext Transaction]
  :<|> "eth":> "v1.2" :> "transaction"
    :> ReqBody '[JSON] PostTransaction
    :> Post '[PlainText] Keccak256
  :<|> "eth":> "v1.2" :> "transactionList"
      :> ReqBody '[JSON] [PostTransaction]
      :> Post '[JSON] [Keccak256]
  :<|> "eth":> "v1.2" :> "transactionResult"
    :> Capture "hash" Keccak256
    :> Get '[JSON] [TransactionResult]
  :<|> "eth":> "v1.2" :> "transactionResult"
    :> "batch"
    :> ReqBody '[PlainText] [Keccak256]
    :> Post '[JSON] BatchTransactionResult
  :<|> "eth":> "v1.2" :> "block"
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
    :> Get '[JSON] [WithNext Block]
  :<|> "eth":> "v1.2" :> "block"
    :> "last"
    :> Capture "integer" Natural
    :> Get '[JSON] [WithNext Block]
  :<|> "eth":> "v1.2" :> "account"
    :> QueryParam "address" Address
    :> QueryParam "balance" Natural
    :> QueryParam "minbalance" Natural
    :> QueryParam "maxbalance" Natural
    :> QueryParam "nonce" Natural
    :> QueryParam "minnonce" Natural
    :> QueryParam "maxnonce" Natural
    :> Get '[JSON] [Account]
  :<|> "eth":> "v1.2" :> "stats"
    :> "difficulty"
    :> Get '[JSON] Difficulty
  :<|> "eth":> "v1.2" :> "stats"
    :> "totaltx"
    :> Get '[JSON] TxCount
  :<|> "eth":> "v1.2" :> "storage"
    :> QueryParam "address" Address
    :> Get '[JSON] [Storage]
  :<|> "eth":> "v1.2" :> "faucet"
    :> ReqBody '[FormUrlEncoded] Address
    :> Post '[PlainText] FaucetResponse
  :<|> "eth":> "v1.2" :> "solc"
    :> ReqBody '[FormUrlEncoded] Src
    :> Post '[PlainText] SolcResponse
  :<|> "eth":> "v1.2" :> "extabi"
    :> ReqBody '[FormUrlEncoded] Src
    :> Post '[PlainText] ExtabiResponse

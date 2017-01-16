{-# LANGUAGE
    DataKinds
  , TypeOperators
#-}

module BlockApps.Strato.API (API) where

import Data.Text (Text)
import Numeric.Natural
import Servant.API

import BlockApps.Strato.Types

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
    :> Get '[JSON] [WithNext Transaction]
  :<|> "transaction"
    :> "last"
    :> Capture "integer" Natural
    :> Get '[JSON] [WithNext Transaction]
  :<|> "transaction"
    :> ReqBody '[JSON] PostTransaction
    :> Post '[PlainText] Text
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
    :> Get '[JSON] [WithNext Block]
  :<|> "block"
    :> "last"
    :> Capture "integer" Natural
    :> Get '[JSON] [WithNext Block]
  :<|> "account"
    :> QueryParam "address" Address
    :> QueryParam "balance" Natural
    :> QueryParam "minbalance" Natural
    :> QueryParam "maxbalance" Natural
    :> QueryParam "nonce" Natural
    :> QueryParam "minnonce" Natural
    :> QueryParam "maxnonce" Natural
    :> Get '[JSON] [Account]
  :<|> "stats"
    :> "difficulty"
    :> Get '[JSON] Difficulty
  :<|> "stats"
    :> "totaltx"
    :> Get '[JSON] TxCount
  :<|> "storage"
    :> QueryParam "address" Address
    :> Get '[JSON] [Storage]
  :<|> "faucet"
    :> ReqBody '[FormUrlEncoded] Address
    :> Post '[PlainText] Text
  :<|> "faucet"
    :> ReqBody '[FormUrlEncoded] Addresses
    :> Post '[PlainText] Text
  :<|> "solc"
    :> ReqBody '[FormUrlEncoded] Src
    :> Post '[PlainText] Text
  :<|> "extabi"
    :> ReqBody '[FormUrlEncoded] Src
    :> Post '[PlainText] Text

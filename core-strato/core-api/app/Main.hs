{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE TypeOperators     #-}

{-# OPTIONS -fno-warn-orphans #-}

module Main where

import           Data.Proxy
import qualified Data.Text                   as T
import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.RequestLogger
import           Servant

import           Blockchain.EthConf
import           Blockchain.Data.Address

import qualified Handlers.AccountInfo            as Account
import qualified Handlers.BatchTransactionResult as BatchTransactionResult
import qualified Handlers.BlkLast                as BlkLast
import qualified Handlers.Block                  as Block
import qualified Handlers.Chain                  as Chain
import qualified Handlers.Coinbase               as Coinbase
import qualified Handlers.Faucet                 as Faucet
import qualified Handlers.Log                    as Log
import qualified Handlers.Peers                  as Peers
import qualified Handlers.QueuedTransactions     as QueuedTransactions
import qualified Handlers.Stats                  as Stats
import qualified Handlers.Storage                as Storage
import qualified Handlers.Transaction            as Transaction
import qualified Handlers.TransactionResult      as TransactionResult
import qualified Handlers.TxLast                 as TxLast
import qualified Handlers.UUID                   as UUID
import qualified Handlers.Version                as Version


type CoreAPI =
  "eth" :> "v1.2" :>
  (
    Account.API
    :<|> BatchTransactionResult.API
    :<|> BlkLast.API
    :<|> Block.API
    :<|> Chain.API
    :<|> Coinbase.API
    :<|> Faucet.API
    :<|> Log.API
    :<|> Peers.API
    :<|> QueuedTransactions.API
    :<|> Stats.API
    :<|> Storage.API
    :<|> Transaction.API
    :<|> TransactionResult.API
    :<|> TxLast.API
    :<|> UUID.API
    :<|> Version.API
  )
  
coreServer :: Server CoreAPI
coreServer =
  Account.server connStr
  :<|> BatchTransactionResult.server connStr
  :<|> BlkLast.server connStr
  :<|> Block.server connStr
  :<|> Chain.server connStr
  :<|> Coinbase.server
  :<|> Faucet.server connStr
  :<|> Log.server connStr
  :<|> Peers.server
  :<|> QueuedTransactions.server connStr
  :<|> Stats.server connStr
  :<|> Storage.server connStr
  :<|> Transaction.server connStr
  :<|> TransactionResult.server connStr
  :<|> TxLast.server connStr
  :<|> UUID.server
  :<|> Version.server

----------------

instance FromHttpApiData Address where
  parseQueryParam x =
    case stringAddress $ T.unpack x of
      Just address -> Right address
      _ -> Left $ T.pack $ "Could not parse address: " ++ show x
  

coreAPI :: Proxy CoreAPI
coreAPI = Proxy

main :: IO ()
main = do
  run 3000 app

app :: Application
app = logStdoutDev $ serve coreAPI coreServer


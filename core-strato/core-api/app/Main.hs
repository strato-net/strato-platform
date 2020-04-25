{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeOperators     #-}

{-# OPTIONS -fno-warn-orphans #-}

module Main where

import           Control.Monad.Logger
import           Data.Proxy
import qualified Data.Text                   as T
import           Database.Persist.Postgresql
import           Network.Wai.Handler.Warp
import           Network.Wai.Middleware.Cors
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
  
coreServer :: ConnectionPool -> Server CoreAPI
coreServer pool =
  Account.server pool
  :<|> BatchTransactionResult.server pool
  :<|> BlkLast.server pool
  :<|> Block.server pool
  :<|> Chain.server pool
  :<|> Coinbase.server
  :<|> Faucet.server pool
  :<|> Log.server pool
  :<|> Peers.server
  :<|> QueuedTransactions.server pool
  :<|> Stats.server pool
  :<|> Storage.server pool
  :<|> Transaction.server pool
  :<|> TransactionResult.server pool
  :<|> TxLast.server pool
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
  pool <- runNoLoggingT $ createPostgresqlPool connStr 20
  run 3000 $ app pool

app :: ConnectionPool -> Application
app pool = 
  logStdoutDev
  $ cors (const $ Just simpleCorsResourcePolicy{corsRequestHeaders=["Content-Type"]})
  $ serve coreAPI $ coreServer pool


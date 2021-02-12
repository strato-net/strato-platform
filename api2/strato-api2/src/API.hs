{-# LANGUAGE DataKinds         #-}
{-# LANGUAGE FlexibleContexts  #-}
{-# LANGUAGE TypeOperators     #-}

module API where

import           Data.Proxy
import           Servant

import           Blockchain.Output
import           Control.Monad.Composable.SQL    hiding (SQLM)
import qualified Handlers.AccountInfo            as Account
import qualified Handlers.Log                    as Log
import qualified Handlers.Peers                  as Peers
import qualified Handlers.Transaction            as Transaction
import qualified Handlers.TransactionResult      as TransactionResult
import qualified Handlers.UUID                   as UUID
import qualified Handlers.Version                as Version

type API =
  "api" :> "v2.0" :>
  (
    Account.API
    :<|> Log.API
    :<|> Peers.API
    :<|> Transaction.API
    :<|> TransactionResult.API
    :<|> UUID.API
    :<|> Version.API
  )

server :: (MonadLogger m, HasSQL m) => ServerT API m
server = Account.server
  :<|> Log.server
  :<|> Peers.server
  :<|> Transaction.server
  :<|> TransactionResult.server
  :<|> UUID.server
  :<|> Version.server

api :: Proxy API
api = Proxy



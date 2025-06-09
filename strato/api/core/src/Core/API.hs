{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE TypeOperators #-}

{-# OPTIONS -fno-warn-orphans #-}

module Core.API
  ( CoreAPI
  , MonadCoreAPI
  , coreApiServer
  , module Handlers.AccountInfo
  , module Handlers.BlkLast
  , module Handlers.Block
  , module Handlers.Metadata
  , module Handlers.Stats
  , module Handlers.Storage
  , module Handlers.Transaction
  , module Handlers.TransactionResult
  , module Handlers.TxLast
  ) where

import           BlockApps.Logging
import           Blockchain.Data.Block
import           Blockchain.Data.DataDefs
import           Blockchain.Sequencer.Event (IngestEvent)
import           Blockchain.Strato.Discovery.Data.Peer (ActivePeers)
import           Blockchain.Strato.Model.Keccak256
import           Blockchain.Strato.Model.Options
import           Blockchain.Strato.Model.Secp256k1
import           Control.Monad.Change.Alter
import           Control.Monad.Change.Modify       (Accessible, Outputs)
import           Control.Monad.Composable.Identity
import           Data.Source.Map
import           Handlers.AccountInfo              hiding (API, server)
import qualified Handlers.AccountInfo              as Account
import           Handlers.BlkLast                  hiding (API, server)
import qualified Handlers.BlkLast                  as BlkLast
import           Handlers.Block                    hiding (API, server)
import qualified Handlers.Block                    as Block
import qualified Handlers.IdentityServerCallback   as Identity
import           Handlers.Metadata                 hiding (API, server)
import qualified Handlers.Metadata                 as Metadata
import qualified Handlers.Peers                    as Peers
import qualified Handlers.QueuedTransactions       as QueuedTransactions
import           Handlers.Stats                    hiding (API, server)
import qualified Handlers.Stats                    as Stats
import           Handlers.Storage                  hiding (API, server)
import qualified Handlers.Storage                  as Storage
import           Handlers.Transaction              hiding (API, server)
import qualified Handlers.Transaction              as Transaction
import           Handlers.TransactionResult        hiding (API, server)
import qualified Handlers.TransactionResult        as TransactionResult
import           Handlers.TxLast                   hiding (API, server)
import qualified Handlers.TxLast                   as TxLast
import           Servant
import           UnliftIO

type CoreAPI =
  "eth" :> "v1.2"
    :> ( Account.API
           :<|> Account.CodeAPI
           :<|> BlkLast.API
           :<|> Block.API
           :<|> Identity.API
           :<|> Metadata.API
           :<|> Peers.API
           :<|> QueuedTransactions.API
           :<|> Stats.API
           :<|> Storage.API
           :<|> Transaction.API
           :<|> TransactionResult.API
           :<|> TxLast.API
       )

type MonadCoreAPI m =
  ( MonadUnliftIO m,
    MonadLogger m,
    Accessible ActivePeers m,
    Accessible Metadata.UrlMap m,
    Accessible IdentityData m,
    Accessible [RawTransaction] m,
    Accessible Stats.TransactionCount m,
    BlkLast.GetLastBlocks m,
    TxLast.GetLastTransactions m,
    HasVault m,
    Selectable Account.AccountsFilterParams [AddressStateRef] m,
    Selectable Block.BlocksFilterParams [Block] m,
    Selectable Keccak256 SourceMap m,
    Selectable Keccak256 [TransactionResult] m,
    Selectable Storage.StorageFilterParams [Storage.StorageAddress] m,
    Selectable Transaction.TxsFilterParams [RawTransaction] m,
    m `Outputs` [IngestEvent]
  )

coreApiServer :: MonadCoreAPI m => ServerT CoreAPI m
coreApiServer =
  Account.server
    :<|> Account.codeServer
    :<|> BlkLast.server
    :<|> Block.server
    :<|> Identity.server
    :<|> Metadata.server
    :<|> Peers.server
    :<|> QueuedTransactions.server
    :<|> Stats.server
    :<|> Storage.server
    :<|> Transaction.server flags_txSizeLimit
    :<|> TransactionResult.server
    :<|> TxLast.server
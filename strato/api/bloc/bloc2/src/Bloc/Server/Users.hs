{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeOperators #-}

module Bloc.Server.Users
  ( postUsersFill,
  )
where

import Bloc.API.Users
import Bloc.API.Utils
-- import Bloc.Monad
-- import Bloc.Server.TransactionResult
-- import Bloc.Server.Utils
import BlockApps.Logging
import BlockApps.Solidity.Contract ()
-- import Blockchain.DB.CodeDB
-- import Blockchain.Data.AddressStateDB
-- import Blockchain.Strato.Model.Account
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Keccak256
-- import Control.Lens
-- import Control.Monad
-- import qualified Control.Monad.Change.Alter as A
-- import Control.Monad.Composable.SQL
-- import Data.Source.Map (SourceMap)
-- import Handlers.AccountInfo
-- import Handlers.Faucet
-- import SQLM
-- import UnliftIO

postUsersFill :: (MonadLogger m) =>
  JwtToken ->
  Address ->
  Bool ->
  m BlocTransactionResult
postUsersFill _ _ _ = pure $ BlocTransactionResult Success zeroHash Nothing Nothing --TODO: Remove endpiont entirely

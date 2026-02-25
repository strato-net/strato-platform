{-# LANGUAGE ConstraintKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE ImplicitParams #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE TypeSynonymInstances #-}

-- {-# OPTIONS -fno-warn-unused-top-binds #-}

module Bloc.Monad
  ( Should (..),
    Compile (..),
    CacheNonce (..),
    HasBlocEnv,
    blocMaybe,
    getBlocEnv,
    blocVaultWrapper,
    BlocEnv (..),
  )
where

import BlockApps.Logging
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.Nonce
import Control.Monad.Change.Modify hiding (modify)
import Control.Monad.Composable.Vault
import Control.Monad.Reader
import Data.Cache
import Data.Text (Text)
import GHC.Stack
import SQLM
import Servant.Client (ClientM)
import Strato.Auth.Client (runWithAuth)
import qualified Strato.Strato23.API.Types         as V
import UnliftIO hiding (Handler (..))

data Should a = Don't a | Do a

data Compile = Compile

data CacheNonce = CacheNonce

type HasBlocEnv m = Accessible BlocEnv m

data BlocEnv = BlocEnv
  { stateFetchLimit :: Integer,
    txSizeLimit :: Int,
    gasLimit :: Integer,
    globalNonceCounter :: Cache Address Nonce,
    nodePubKey :: V.PublicKey
  }

--------------------------------------------------------------------------------

blocVaultWrapper ::
  (MonadIO m, MonadLogger m, Accessible VaultData m, HasCallStack) =>
  ClientM x ->
  m x
blocVaultWrapper client' = do
  logInfoCS callStack "Querying Vault"
  env <- access Proxy
  resultEither <- liftIO $ runWithAuth env client'
  either (blocError . VaultWrapperError) return resultEither

blocMaybe :: MonadIO m => Text -> Maybe x -> m x
blocMaybe msg = maybe (throwIO (CouldNotFind msg)) return

getBlocEnv :: HasBlocEnv m => m BlocEnv
getBlocEnv = access Proxy

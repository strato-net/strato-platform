{-# LANGUAGE ConstraintKinds            #-}
{-# LANGUAGE DeriveAnyClass             #-}
{-# LANGUAGE FlexibleContexts           #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE ImplicitParams             #-}
{-# LANGUAGE LambdaCase                 #-}
{-# LANGUAGE MultiParamTypeClasses      #-}
{-# LANGUAGE OverloadedStrings          #-}
{-# LANGUAGE RecordWildCards            #-}
{-# LANGUAGE ScopedTypeVariables        #-}
{-# LANGUAGE TemplateHaskell            #-}
{-# LANGUAGE TypeFamilies               #-}

{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE FlexibleInstances #-}
-- {-# OPTIONS -fno-warn-unused-top-binds #-}

module BlockApps.Bloc22.Monad (
  Should(..),
  Compile(..),
  CacheNonce(..),
  HasBlocEnv,
  blocQuery,
  blocQuery1,
  blocMaybe,
  getBlocEnv,
  blocTransaction,
  blocVaultWrapper,
  blocStrato,
  blocModify,
  blocModify1,
  blocQueryMaybe,
  BlocEnv(..)
  ) where


import           Control.Monad.Reader
import           Data.Cache
import           Data.Foldable
import           Data.Map.Strict                    (Map)
import           Data.Pool                          (withResource)
import           Data.Profunctor.Product.Default
import           Data.Text                          (Text)
import qualified Data.Text                          as Text
import           Database.PostgreSQL.Simple         (Connection,
                                                     withTransaction)
import           GHC.Stack
import           Opaleye
import           Servant
import           Servant.Client

import           UnliftIO                           hiding (Handler(..))

import           BlockApps.Bloc22.API.Transaction
import           BlockApps.Logging
import           BlockApps.Solidity.Xabi
import           Blockchain.Strato.Model.Account
import           Blockchain.Strato.Model.ChainId
import           Blockchain.Strato.Model.CodePtr
import           Blockchain.Strato.Model.Nonce
import           Data.Source.Map

import           Control.Monad.Change.Modify        hiding (modify)
import           Control.Monad.Composable.BlocSQL
import           Control.Monad.Composable.CoreAPI   hiding (httpManager)
import           Control.Monad.Composable.Vault     hiding (httpManager)

import           SQLM

data Should a = Don't a | Do a
data Compile = Compile
data CacheNonce = CacheNonce

type HasBlocEnv m = Accessible BlocEnv m

data BlocEnv = BlocEnv
  { stateFetchLimit    :: Integer
  , gasOn              :: Bool
  , evmCompatible      :: Bool
  , globalNonceCounter :: Cache Account Nonce
  , globalSourceCache  :: Cache (Text, SourceMap) (Map Text ContractDetails)
  , globalCodePtrCache :: Cache CodePtr ContractDetails
  , txTBQueue          :: TBQueue (Maybe Text, Maybe ChainId, Bool, PostBlocTransactionRequest)
  }

--------------------------------------------------------------------------------

blocQuery :: (HasCallStack, Default Unpackspec x x, Default QueryRunner x y, HasBlocSQL m,
              MonadLogger m) =>
             Query x -> m [y]
blocQuery q = do
  traverse_ (logInfoCS callStack . Text.pack) (showSql q)
  BlocSQLEnv pool <- access Proxy
  liftIO $ withResource pool $ liftIO . flip runSelect q

blocQueryMaybe
  :: (HasCallStack, Default Unpackspec x x, Default QueryRunner x y,
      MonadIO m, MonadLogger m, HasBlocSQL m)
  => Query x
  -> m (Maybe y)
blocQueryMaybe q = blocQuery q >>= \case
    [] -> return Nothing
    [y] -> return (Just y)
    _:_:_ -> throwIO $ DBError "blocQueryMaybe: Multiple results, expected one row"

blocQuery1
  :: (HasCallStack, Default Unpackspec x x, Default QueryRunner x y,
      MonadIO m, MonadLogger m, HasBlocSQL m) =>
  Text -> Query x -> m y
blocQuery1 loc q = blocQuery q >>= \case
    [] -> blocError . DBError . Text.concat $ ["blocQuery1: ", loc, ": No result, expected one row"]
    [y] -> return y
    _:_:_ -> throwIO . DBError . Text.concat $
       ["blocQuery1: ", loc, ": Multiple results, expected one row"]

blocModify :: (HasCallStack, MonadIO m, HasBlocSQL m, MonadLogger m) =>
              (Connection -> IO x) -> m x
blocModify modify = do
  logInfoCS callStack "Updating the database"
  BlocSQLEnv pool <- access Proxy
  liftIO $ withResource pool (liftIO . modify)

blocModify1 :: (HasCallStack, MonadIO m, HasBlocSQL m, MonadLogger m) =>
               (Connection -> IO [x]) -> m x
blocModify1 modify = do
  logInfoCS callStack "Updating the database"
  results <- blocModify modify
  case results of
    []    -> throwIO $ DBError "No result, expected one row"
    [y]   -> return y
    _:_:_ -> throwIO $ DBError "Multiple results, expected one row"

blocTransaction :: HasBlocSQL m =>
                   m x -> m x
blocTransaction bloc = do
  BlocSQLEnv pool <- access Proxy
  bloc' <- toIO bloc
  liftIO $ withResource pool $ \conn -> withTransaction conn bloc'

blocStrato :: (MonadIO m, MonadLogger m, HasCoreAPI m, HasCallStack) =>
              ClientM x -> m x
blocStrato client' = do
  logInfoCS callStack "Querying Strato"
  CoreAPIData url mgr <- access Proxy
  resultEither <-
    liftIO $ runClientM client' (mkClientEnv mgr url)
  either (blocError . StratoError) return resultEither

blocVaultWrapper :: (MonadIO m, MonadLogger m, HasVault m, HasCallStack) =>
                    ClientM x -> m x
blocVaultWrapper client' = do
  logInfoCS callStack "Querying Vault Wrapper"
  VaultData url mgr <- access Proxy
  resultEither <-
    liftIO $ runClientM client' (mkClientEnv mgr url)
  either (blocError . VaultWrapperError) return resultEither

blocMaybe :: MonadIO m => Text -> Maybe x -> m x
blocMaybe msg = maybe (throwIO (CouldNotFind msg)) return

getBlocEnv :: HasBlocEnv m => m BlocEnv
getBlocEnv = access Proxy

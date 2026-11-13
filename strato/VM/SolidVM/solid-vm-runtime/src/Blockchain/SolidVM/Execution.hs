{-# LANGUAGE AllowAmbiguousTypes #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE MultiParamTypeClasses #-}

module Blockchain.SolidVM.Execution
  ( Interpreted, Native, MonadContractCreation (..), MonadValueOperations (..), compileSourceForCreation
  ) where

import BlockApps.Logging (MonadLogger)
import Blockchain.DB.AddressStateDB (HasAccountDB)
import Blockchain.Data.ExecResults (ExecResults)
import Blockchain.SolidVM.CodeCollectionDB (codeCollectionFromSourceWith)
import qualified Blockchain.SolidVM.Environment as Env
import Blockchain.SolidVM.SM
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Strato.Model.Keccak256 (Keccak256)
import Control.Monad.IO.Class (MonadIO)
import qualified Control.Monad.Change.Modify as Mod
import qualified Data.Text as T
import qualified Data.Text.Encoding as DT
import SolidVM.Model.CodeCollection (CodeCollection)
import SolidVM.Model.SolidString (SolidString)
import SolidVM.Model.Value (Value, Variable, ValList)

data Interpreted
data Native

class (MonadIO m, MonadLogger m, HasAccountDB m, Mod.Modifiable [CallInfo] m) => MonadContractCreation engine m where
  prepareContractSource :: String -> m (Keccak256, CodeCollection)
  runContractConstructor :: Address -> Address -> Keccak256 -> CodeCollection -> SolidString -> ValList -> m ExecResults

class MonadIO m => MonadValueOperations engine m where
  forceBuiltinValue :: Value -> m Value
  showBuiltinValue :: Value -> m String
  readBuiltinInteger :: Variable -> m Integer
  writeBuiltinVariable :: Variable -> Value -> m ()

compileSourceForCreation :: Bool -> String -> SM (Keccak256, CodeCollection)
compileSourceForCreation typeCheck source = do
  -- Because of the current testnet stateroot problem with contracts using an older version of
  -- create/create2 with incomplete codeptrs, this pragma will allow new contract using the
  -- create/create2 features to work correctly but unfortunately, even without the pragma, the contracts
  -- will still work but will have incorrect codeptrs.
  -- Thus, when the testnet wipes, this pragma can largely be removed because the old contracts on the
  -- testnet won't exist anymore and the stateroot mismatches will be fixed.
  isRunningTests <- Env.runningTests <$> getEnv
  opts <- parseOptionsForCurrentBlock
  pair@(hsh, cc) <- codeCollectionFromSourceWith opts isRunningTests typeCheck (DT.encodeUtf8 $ T.pack source)
  addNewCodeCollection hsh cc
  pure pair

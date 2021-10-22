{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE TemplateHaskell #-}

module SolidVM.Solidity.Fuzzer.Types where

import           Blockchain.MemVMContext
import           Blockchain.SolidVM.Simple
import           Control.Lens
import           Control.Monad.Trans.Reader
import           Data.Aeson (ToJSON, FromJSON)
import           Data.Source
import           Data.Text (Text)
import           GHC.Generics

data FuzzerArgs = FuzzerArgs
  { _fuzzerArgsSrc :: SourceMap
  , _fuzzerArgsContractName :: Text
  , _fuzzerArgsCreateArgs :: Text
  , _fuzzerArgsFuncName :: Text
  , _fuzzerArgsCallArgs :: Text
  , _fuzzerArgsMaxRuns :: Maybe Integer
  } deriving (Eq, Show, Generic, ToJSON, FromJSON)
makeLenses ''FuzzerArgs

type FuzzerM = ReaderT FuzzerArgs MemContextM

data FuzzerTx = FuzzerTx
  { _fuzzerTxFuncName :: Text
  , _fuzzerTxArgs     :: Text
  } deriving (Eq, Show, Generic, ToJSON, FromJSON)
makeLenses ''FuzzerTx

data FuzzerFailureDetails = FuzzerFailureDetails
   { _failureContractAddress :: Account
   , _failureContractName :: Text
   , _failureCreateArgs :: Text
   , _failureTxs :: [FuzzerTx]
   } deriving (Eq, Show, Generic, ToJSON, FromJSON)
makeLenses ''FuzzerFailureDetails

data FuzzerResultF a = FuzzerSuccess a
                     | FuzzerFailure
                       { _fuzzerFailureDetails :: Maybe FuzzerFailureDetails
                       , _fuzzerFailureContext :: a
                       } deriving (Eq, Show, Generic, ToJSON, FromJSON)
makePrisms ''FuzzerResultF

type FuzzerResult = Annotated FuzzerResultF
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveFunctor #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE TemplateHaskell #-}

module SolidVM.Solidity.Fuzzer.Types where

import Blockchain.Data.BlockHeader
import Blockchain.Strato.Model.Address
import Control.Lens
import Control.Monad.Trans.Reader
import Data.Aeson (FromJSON, ToJSON)
import Data.Source
import Data.Text (Text)
import GHC.Generics
import SolidVM.Model.SolidString
import UnliftIO

data FuzzerArgs = FuzzerArgs
  { _fuzzerArgsSrc :: SourceMap,
    _fuzzerArgsContractName :: SolidString,
    _fuzzerArgsCreateArgs :: [Text],
    _fuzzerArgsFuncName :: SolidString,
    _fuzzerArgsCallArgs :: [Text],
    _fuzzerArgsMaxRuns :: Maybe Integer
  }
  deriving (Eq, Show, Generic, ToJSON, FromJSON)

makeLenses ''FuzzerArgs

data FuzzerContext = FuzzerContext
  { _fuzzerContextArgs :: FuzzerArgs
  , _fuzzerContextBlockHeader :: IORef BlockHeader
  }

makeLenses ''FuzzerContext

type FuzzerM m = ReaderT FuzzerContext m

data FuzzerTx = FuzzerTx
  { _fuzzerTxFuncName :: SolidString,
    _fuzzerTxArgs :: [Text]
  }
  deriving (Eq, Show, Generic, ToJSON, FromJSON)

makeLenses ''FuzzerTx

data FuzzerFailureDetails = FuzzerFailureDetails
  { _failureContractAddress :: Address,
    _failureContractName :: SolidString,
    _failureCreateArgs :: [Text],
    _failureTxs :: [FuzzerTx]
  }
  deriving (Eq, Show, Generic, ToJSON, FromJSON)

makeLenses ''FuzzerFailureDetails

data FuzzerResultF a
  = FuzzerSuccess a
  | FuzzerFailure
      { _fuzzerFailureDetails :: Maybe FuzzerFailureDetails,
        _fuzzerFailureContext :: a
      }
  deriving (Eq, Show, Functor, Generic, ToJSON, FromJSON)

makePrisms ''FuzzerResultF

type FuzzerResult = Annotated FuzzerResultF

type FuzzerTestAndResult = FuzzerResultF (SourceAnnotation (Text, Text))

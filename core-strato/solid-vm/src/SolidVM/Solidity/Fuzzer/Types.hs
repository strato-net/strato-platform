{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE TemplateHaskell #-}

module SolidVM.Solidity.Fuzzer.Types where

import           Blockchain.MemVMContext
import           Blockchain.SolidVM.Simple
import           CodeCollection
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

type FuzzerM = ReaderT (FuzzerArgs, CodeCollection) MemContextM

data FuzzerTx = FuzzerTx
  { _fuzzerTxFuncName :: Text
  , _fuzzerTxArgs     :: Text
  } deriving (Eq, Show, Generic, ToJSON, FromJSON)
makeLenses ''FuzzerTx

data FuzzerResult = FuzzerSuccess
                  | FuzzerFailure
                    { _fuzzerResultContractAddress :: Account
                    , _fuzzerResultContractName :: Text
                    , _fuzzerResultCreateArgs :: Text
                    , _fuzzerResultTxs :: [FuzzerTx]
                    , _fuzzerResultException  :: SolidException
                    } deriving (Eq, Show, Generic, ToJSON, FromJSON)
makePrisms ''FuzzerResult
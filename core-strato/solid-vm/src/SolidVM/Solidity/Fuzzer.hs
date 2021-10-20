{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}
module SolidVM.Solidity.Fuzzer 
  ( runFuzzer
  , module SolidVM.Solidity.Fuzzer.Types
  ) where

import           Blockchain.MemVMContext
import           Blockchain.Output
import           Blockchain.SolidVM.Simple
import           CodeCollection
import           Control.Lens
import           Control.Monad.Trans.Class (lift)
import           Control.Monad.Trans.Reader
import qualified Data.Aeson as Aeson
import qualified Data.ByteString.Lazy as BL
import           Data.Maybe (fromMaybe)
import           Data.Source
import qualified Data.Map.Strict as M
import           Data.Traversable (for)
import           SolidVM.Solidity.Fuzzer.Types

defaultFuzzerRuns :: Integer
defaultFuzzerRuns = 100

runFuzzer :: Traversable t
          => (SourceMap -> t CodeCollection)
          -> FuzzerArgs
          -> IO (t [FuzzerResult])
runFuzzer compile args = do
  for (compile $ args ^. fuzzerArgsSrc) $ \cc ->
    runLoggingT . evalMemContextM Nothing . flip runReaderT (args, cc) $
      runFuzzerNTimes . fromMaybe defaultFuzzerRuns $ args ^. fuzzerArgsMaxRuns

runFuzzerNTimes :: Integer -> FuzzerM [FuzzerResult]
runFuzzerNTimes n | n <= 0 = pure [FuzzerSuccess]
runFuzzerNTimes n = runFuzzerOnce >>= \case
  FuzzerSuccess -> runFuzzerNTimes (n-1) 
  r -> pure [r]

runFuzzerOnce :: FuzzerM FuzzerResult
runFuzzerOnce = do
  ~(FuzzerArgs{..}, _) <- ask
  let svmErr (Left e) = e
      svmErr (Right e) = InternalError "SolidVM for non-solidvm code" (show e)
      contractAddress = Account 0xdeadbeef Nothing
      txArgs = def & createNewAddress .~ contractAddress
                   & createCode .~ (Code . BL.toStrict $ Aeson.encode _fuzzerArgsSrc)
                   & createArgs . argsMetadata ?~ M.empty
                   & createArgs . argsMetadata . _Just . at "name" ?~ _fuzzerArgsContractName
                   & createArgs . argsMetadata . _Just . at "args" ?~ _fuzzerArgsCreateArgs
      failure = FuzzerFailure contractAddress _fuzzerArgsContractName _fuzzerArgsCreateArgs
  createResults <- lift $ create txArgs
  case erException createResults of
    Just e -> pure $ failure [] $ svmErr e
    Nothing -> do
      let txArgs' = def & callArgs . argsBlockData .~ txArgs ^. createArgs . argsBlockData
                        & callCodeAddress .~ contractAddress
                        & callArgs . argsMetadata ?~ M.empty
                        & callArgs . argsMetadata . _Just . at "funcName" ?~ _fuzzerArgsFuncName
                        & callArgs . argsMetadata . _Just . at "args" ?~ _fuzzerArgsCallArgs
      callResults <- lift $ call txArgs'
      case erException callResults of
        Nothing -> pure FuzzerSuccess
        Just e' -> pure $ case svmErr e' of
          Require _ -> FuzzerSuccess
          e -> let tx = FuzzerTx _fuzzerArgsFuncName _fuzzerArgsCallArgs in failure [tx] e
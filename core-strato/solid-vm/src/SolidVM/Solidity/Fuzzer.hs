{-# LANGUAGE OverloadedStrings #-}
module SolidVM.Solidity.Fuzzer 
  ( runFuzzer
  ) where

import           Blockchain.MemVMContext
import           Blockchain.Output
import           Blockchain.SolidVM.Simple
import           CodeCollection
import           Control.Lens
import qualified Data.Aeson as Aeson
import qualified Data.ByteString.Lazy as BL
import           Data.Source
import qualified Data.Map.Strict as M
import           Data.Maybe (isNothing)
import           Data.Text (Text)
import           Data.Traversable (for)

runFuzzer :: Traversable t
          => (SourceMap -> t CodeCollection)
          -> SourceMap
          -> Text
          -> Text
          -> Text
          -> Text
          -> IO (t Aeson.Value)
runFuzzer compile srcs cName createArgs' method callArgs' = for (compile srcs) $ \_ -> runNoLoggingT . evalMemContextM Nothing $ do
  let contractAddress = Account 0xdeadbeef Nothing
      createArgs'' = def & createNewAddress .~ contractAddress
                         & createCode .~ (Code . BL.toStrict $ Aeson.encode srcs)
                         & createArgs . argsMetadata ?~ M.empty
                         & createArgs . argsMetadata . _Just . at "name" ?~ cName
                         & createArgs . argsMetadata . _Just . at "args" ?~ createArgs'
  createResults <- create createArgs''
  case erException createResults of
    Just _ -> pure $ Aeson.toJSON False
    Nothing -> do
      let callArgs'' = def & callCodeAddress .~ contractAddress
                           & callArgs . argsMetadata ?~ M.empty
                           & callArgs . argsMetadata . _Just . at "funcName" ?~ method
                           & callArgs . argsMetadata . _Just . at "args" ?~ callArgs'
      callResults <- call callArgs''
      pure . Aeson.toJSON . isNothing $ erException callResults
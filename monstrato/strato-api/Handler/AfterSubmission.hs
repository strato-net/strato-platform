{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes       #-}
{-# LANGUAGE TemplateHaskell   #-}
{-# LANGUAGE TypeFamilies      #-}

module Handler.AfterSubmission where

import qualified Data.Text   as T

import           Import
import           Text.Julius

postAfterSubmissionR::Handler Html
postAfterSubmissionR = do
  maybeABI <- lookupPostParam "abi"
  maybeContractAddress <- lookupPostParam "contractAddress"
  maybeTransactionHash <- lookupPostParam "transactionHash"
  liftIO $ putStrLn $ T.pack $ show maybeABI
  case (maybeABI, maybeContractAddress, maybeTransactionHash) of
    (Nothing, _, _) -> invalidArgs ["Missing 'abi'"]
    (_, Nothing, _) -> invalidArgs ["Missing 'contractAddress'"]
    (_, _, Nothing) -> invalidArgs ["Missing 'transactionHash'"]
    (Just abi, Just contractAddress, Just transactionHash) -> defaultLayout $ do
      setTitle "Contract Submitted"
      $(widgetFile "afterSubmission")



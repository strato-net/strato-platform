module Handler.TransactionDemo where

import Text.Julius

import Import

postTransactionDemoR :: Handler Html
postTransactionDemoR = do
  maybeABI <- lookupPostParam "abi"
  maybeContractAddress <- lookupPostParam "contractAddress"

  case (maybeABI, maybeContractAddress) of
    (Nothing, _) -> invalidArgs ["Missing 'abi'"]
    (_, Nothing) -> invalidArgs ["Missing 'contractAddress'"]
    (Just abi, Just contractAddress) -> defaultLayout $ do
      addScriptRemote "/static/js/pushtx.js"
  
      setTitle "Transaction Demo"
      $(widgetFile "transactionDemo")
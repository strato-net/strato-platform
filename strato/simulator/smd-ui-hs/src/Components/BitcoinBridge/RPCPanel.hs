{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

module Components.BitcoinBridge.RPCPanel where

import Reflex.Dom hiding (Value)
import Components.TerminalWidget (terminalWidget)
import Control.Exception
import Control.Monad.IO.Class (liftIO)
import Data.Aeson
import Data.Text (Text)
import qualified Data.Text as T
import Data.Text.Encoding (encodeUtf8)
import Frontend.BridgeClient
import Types.State

rpcTabWidget :: MonadWidget t m => Dynamic t AppState -> m ()
rpcTabWidget _ = do
  elClass "div" "rpc-panel" $ mdo
    el "h3" $ text "Bitcoin JSON-RPC Terminal"

    elClass "div" "rpc-output" $ do
      dyn_ $ ffor resultsDyn $ \ls ->
        elClass "pre" "rpc-log" $ mapM_ (\l -> el "div" $ text l) ls

    -- Method input
    (methodInput, paramsInput, submitEv) <- elClass "div" "rpc-input" $ do
      el "label" $ text "Method"
      methodInput' <- inputElement def
      el "label" $ text "Params (as JSON array)"
      paramsInput' <- textAreaElement $ def & textAreaElementConfig_initialValue .~ "[]"
      submitEv' <- el "div" $ button "Execute"
      pure (methodInput', paramsInput', submitEv')

    let commandEv = tagPromptlyDyn ((,) <$> value methodInput <*> value paramsInput) submitEv

    resultEv <- performEventAsync $ ffor commandEv $ \(mTxt, pTxt) cb -> liftIO $ do
      case eitherDecodeStrict (encodeUtf8 pTxt) of
        Left err -> cb $ "Invalid params: " <> T.pack err
        Right (params' :: [Value]) -> do
          res <- try @SomeException $ sendRpcCommand mTxt params'
          cb $ either (T.pack . show) id res

    resultsDyn <- foldDyn (\line acc -> acc ++ [line]) [] resultEv
    pure ()

rpcTabWidget' :: MonadWidget t m => Dynamic t AppState -> m ()
rpcTabWidget' _ = terminalWidget "Bitcoin JSON-RPC Terminal" runRpc

runRpc :: Text -> IO (Either Text Text)
runRpc txt = do
  -- parse command
  let parts = T.words txt
  case parts of
    (cmd:args) ->
      case eitherDecodeStrict (encodeUtf8 $ "[" <> T.unwords args <> "]") of
        Left err -> pure $ Left $ "Param parse error: " <> T.pack err
        Right (params :: [Value]) -> do
          res <- try @SomeException $ sendRpcCommand cmd params
          pure $ either (Left . T.pack . show) Right res
    [] -> pure $ Left "No method provided"
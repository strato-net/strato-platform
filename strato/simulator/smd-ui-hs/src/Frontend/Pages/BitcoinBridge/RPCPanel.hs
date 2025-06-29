{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections #-}
{-# LANGUAGE TypeApplications #-}

module Frontend.Pages.BitcoinBridge.RPCPanel (rpcTabWidget) where

import Common.BridgeClient
import Control.Exception
import Control.Monad.IO.Class (liftIO)
import Data.Aeson
import Data.Bifunctor (first)
import Data.Bool (bool)
import qualified Data.Map.Strict as M
import Data.Text (Text)
import qualified Data.Text as T
import Data.Text.Encoding (encodeUtf8)
import Frontend.Components.Button
import Frontend.Components.Card
import Frontend.Components.Input
import Frontend.Types.State
import Reflex.Dom hiding (Value)

rpcTabWidget :: MonadWidget t m => Dynamic t AppState -> m ()
rpcTabWidget _ = mdo
  historyDyn <- foldDyn (maybe id (:)) [] resultEv
  resultEv <- performEventAsync $ ffor submitCommandEv $ \cmd cb -> liftIO $ do
    let cmdArgs = case T.words cmd of
          [] -> Nothing
          [c] -> Just $ (c, Right [])
          (c:as) -> Just . (c,) $ eitherDecodeStrict (encodeUtf8 $ "[" <> T.intercalate "," as <> "]")
    case cmdArgs of
      Nothing -> cb Nothing
      Just (_, Left err) -> cb $ Just (cmd, Left $ "Invalid params: " <> T.pack err)
      Just (c, Right (params' :: [Value])) -> do
        res <- try @SomeException $ sendRpcCommand c params'
        cb . Just . (cmd,) $ first (T.pack . show) res
  submitCommandEv <- elClass "div" "container mx-auto py-8 px-4 max-w-5xl" $ do
    card (constDyn "shadow-lg border-gray-200") $ do
      cardHeader (constDyn "border-b bg-slate-800 text-white") $ do
        cardTitle (constDyn "flex items-center gap-2") $ do
          terminalIcon ""
          el "span" $ text "Bitcoin RPC Terminal"
      cardContent (constDyn "p-0") $ do
        elAttr "div" (   ("class" =: "bg-slate-900 text-green-400 font-mono text-sm p-4 rounded-b overflow-auto")
                      <> ("style" =: "minHeight: 400px; maxHeight: 60vh;")
                     ) $ do
          elClass "div" "mb-4 text-slate-400 border-b border-slate-700 pb-2" $ do
            el "p" $ text "Connected to Bitcoin Core RPC"
            el "p" $ text "Type 'help' for available commands"
          elClass "div" "space-y-4 mb-4" $ dyn_ $ ffor (reverse . zip [(0 :: Integer)..] <$> historyDyn) . traverse $ \(i, (cmd, res)) -> do
            elAttr "div" (("key" =: T.pack (show i)) <> ("class" =: "space-y-1")) $ do
              elClass "div" "flex" $ do
                elClass "span" "text-yellow-500 mr-2" $ text "$"
                elClass "span" "text-white" $ text cmd
              case res of
                Left e -> elClass "pre" "whitespace-pre-wrap text-red-300 pl-4 border-l border-slate-700" $ do
                  text e
                Right r -> elClass "pre" "whitespace-pre-wrap text-green-300 pl-4 border-l border-slate-700" $ do
                  text . T.pack $ show r
          elClass "div" "p-4 border-t border-gray-200 flex gap-2" $ do
            let attrs = mapKeysToAttributeName $ M.fromList [("type", "text"), ("placeholder", "Enter RPC command..."), ("class","font-mono")]
            commandInputEl <- input $ def
              & inputElementConfig_initialValue .~ ""
              & inputElementConfig_setValue .~ ("" <$ resultEv)
              & inputElementConfig_elementConfig . elementConfig_initialAttributes .~ attrs
            (buttonEl, _) <- button' (constDyn $ def { _bpClassName = "bg-slate-800 hover:bg-slate-700" }) $ text "Execute"
            let clickEv = domEvent Click buttonEl
                enterEv = fmapMaybe (bool Nothing (Just ()) . (== Enter) . keyCodeLookup . fromIntegral) $ domEvent Keypress $ _inputElement_element commandInputEl
                submitEv = leftmost [clickEv, enterEv]
            pure $ tag (current $ _inputElement_value commandInputEl) submitEv
  pure ()

elSvgAttr :: MonadWidget t m => Text -> M.Map Text Text -> m a -> m a
elSvgAttr elTag attrs = fmap snd . elDynAttrNS' (Just "http://www.w3.org/2000/svg") elTag (constDyn attrs)

terminalIcon :: MonadWidget t m => Text -> m ()
terminalIcon className =
  elSvgAttr "svg" ( ("width" =: "24")
                  <> ("height" =: "24")
                  <> ("viewBox" =: "0 0 24 24")
                  <> ("fill" =: "none")
                  <> ("stroke" =: "currentColor")
                  <> ("stroke-width" =: "2")
                  <> ("stroke-linecap" =: "round")
                  <> ("stroke-linejoin" =: "round")
                  <> ("class" =: className)
                   ) $ do
    elSvgAttr "polyline" ("points" =: "4 17 10 11 4 5") blank
    elSvgAttr "line" (   ("x1" =: "12")
                      <> ("x2" =: "20")
                      <> ("y1" =: "19")
                      <> ("y2" =: "19")
                     ) blank
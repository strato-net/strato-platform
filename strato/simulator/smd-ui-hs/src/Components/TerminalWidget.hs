{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Components.TerminalWidget (terminalWidget) where

import Reflex.Dom
-- import Control.Monad.IO.Class (liftIO)
-- import Control.Monad (void)
import Data.Text (Text)
-- import qualified Data.Text as T
-- import qualified Data.Text.Encoding as T
-- import Language.Javascript.JSaddle (eval, liftJSM)
-- import Text.Read (readMaybe)

terminalWidget
  :: MonadWidget t m
  => Text                                -- ^ Terminal title
  -> (Text -> IO (Either Text Text))     -- ^ Execute function
  -> m ()
terminalWidget label _ = elClass "div" "rpc-panel" $ do -- label runCommand = elClass "div" "rpc-panel" $ mdo
  el "h3" $ text label
-- 
--   -- Text area input
--   el "label" $ text "Command"
--   input <- textAreaElement $ def
--     & textAreaElementConfig_elementConfig
--     . elementConfig_initialAttributes
--     .~ ("class" =: "terminal-input")
-- 
--   -- Submit on Ctrl+Enter
--   let keyEv = domEvent Keydown input
--       ctrlEnterEv = ffilter (\e -> keyCodeLookup e == fromIntegral 13) keyEv
-- 
--   -- Submit button
--   submitBtn <- button "Send"
-- 
--   let submitEv = leftmost
--         [ () <$ ctrlEnterEv
--         , () <$ submitBtn
--         ]
-- 
--       commandEv = tagPromptlyDyn (value input) submitEv
-- 
--   -- History and results
--   historyDyn <- foldDyn (\cmd hist -> hist ++ [cmd]) [] commandEv
--   outputDyn  <- foldDyn (\res acc -> acc ++ [either id id res]) [] =<<
--     performEvent (fmap (\cmd -> liftIO (runCommand cmd)) commandEv)
-- 
--   -- Scroll to bottom on update
--   dyn_ $ ffor outputDyn $ \_ -> performEvent_ . liftJSM $
--     eval "(function() { let el = document.getElementById('rpc-log'); if (el) el.scrollTop = el.scrollHeight; })();"
-- 
--   -- Render terminal output
--   elClass "div" "rpc-output" $ do
--     elAttr "div" ("id" =: "rpc-log") $ do
--       dyn_ $ ffor outputDyn $ \lines -> elClass "pre" "rpc-log" $
--         mapM_ (\l -> el "div" $ text l) lines
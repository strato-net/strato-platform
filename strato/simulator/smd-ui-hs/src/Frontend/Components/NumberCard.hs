{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}

module Frontend.Components.NumberCard where

import Reflex.Dom
import qualified Data.Text as T

data NumberCardConfig = NumberCardConfig
  { number :: T.Text
  , description :: T.Text
  , iconClass :: T.Text
  , mode :: T.Text
  }

numberCard :: MonadWidget t m => NumberCardConfig -> m ()
numberCard config = do
  elClass "div" (T.unwords ["number-card", "mode-" <> mode config]) $ do
    elClass "div" "number-card-content" $ do
      elClass "i" (T.unwords ["fa", iconClass config]) blank
      el "h3" $ text (number config)
      el "p" $ text (description config)
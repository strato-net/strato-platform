{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.StatCard (statCard) where

import Reflex.Dom
import qualified Data.Text as T

statCard :: MonadWidget t m => T.Text -> T.Text -> m ()
statCard val label = elClass "div" "stat-card" $ do
  elClass "div" "stat-value" $ text val
  elClass "div" "stat-label" $ text label
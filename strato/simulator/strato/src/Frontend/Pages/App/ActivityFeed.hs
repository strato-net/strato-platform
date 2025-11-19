{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TupleSections #-}

module Frontend.Pages.App.ActivityFeed where

import Control.Lens
import Frontend.Components.SVG.Activity
import Reflex.Dom

appActivityFeed :: MonadWidget t m => m ()
appActivityFeed = elClass "main" "p-4 sm:p-6" $ do
  elClass "div" "mb-6 sm:mb-8" $ do
    elClass "div" "flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4" $ do
      activity $ def
        & svg_class .~ "h-5 w-5 sm:h-6 sm:w-6 text-blue-600"
      elClass "h1" "text-xl sm:text-2xl font-bold text-gray-900" $
        text "Blockchain Events"
    elClass "p" "text-sm sm:text-base text-gray-600" $
      text "View all events emitted from smart contracts on the blockchain"
    
  text "ActivityFeedList" -- TODO: ActivityFeedList
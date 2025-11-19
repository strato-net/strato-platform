{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Frontend.Pages.App.Swap where

import Frontend.Types.State hiding (Transaction(..))
import Reflex.Dom

appSwap :: MonadWidget t m => Dynamic t AppState -> m ()
appSwap _ = elClass "main" "p-6" $ do
  elClass "div" "max-w-2xl mx-auto space-y-6" $
    elClass "div" "bg-white shadow-md rounded-lg p-6" $ do
      elClass "h2" "text-xl font-semibold mb-6" $
        text "Exchange your digital assets"
      text "SwapWidget" -- TODO: SwapWidget
  elClass "div" "mt-8 max-w-6xl mx-auto" $
    elClass "div" "bg-white shadow-md rounded-lg p-6" $
      text "SwapHistory" -- TODO: SwapHistory
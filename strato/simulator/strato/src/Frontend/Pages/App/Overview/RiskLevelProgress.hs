{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

module Frontend.Pages.App.Overview.RiskLevelProgress where

import Data.Text (Text)
import qualified Data.Text as T
import Frontend.Components.Progress
import Frontend.Utils
import Reflex.Dom hiding (button)
import Text.Printf

getRiskProfile :: Double -> (Text, Text, Text)
getRiskProfile riskLevel =
  if riskLevel < 30.0
    then ("Low", "bg-green-500", "bg-green-50 text-green-700")
    else if riskLevel < 70.0
           then ("Moderate", "bg-yellow-500", "bg-yellow-50 text-yellow-700")
           else ("High", "bg-red-500", "bg-red-50 text-red-700")

riskLevelProgress :: MonadWidget t m => Dynamic t Double -> m ()
riskLevelProgress = withDyn_ $ \riskLevel -> do
  let (riskText, riskColor, riskClass) = getRiskProfile riskLevel
  elClass "div" "space-y-3" $ do
    elClass "div" "flex justify-between items-center" $ do
      el "span" $ text "Risk Level:"
      elClass "div" "flex items-center gap-2" $
        elClass "span" ("inline-flex px-2 py-1 text-xs font-medium rounded-full " <> riskClass) $
          text riskText
    elClass "div" "relative" $ do
      progress (constDyn $ ProgressProps riskLevel "h-2") $
        elAttr "div" (
               "class" =: ("absolute inset-0 " <> riskColor <> " h-full rounded-full")
            <> "style" =: ("width: " <> T.pack (printf "%.02f" riskLevel) <> "%")
          ) blank
      elClass "div" "flex justify-between mt-1 text-xs text-gray-500" $ do
        el "span" $ text "Safe"
        el "span" $ text "Risk Increases →"
        el "span" $ text "Liquidiation"
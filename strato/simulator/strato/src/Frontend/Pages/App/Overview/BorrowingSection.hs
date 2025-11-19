{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TemplateHaskell #-}

module Frontend.Pages.App.Overview.BorrowingSection where

import Control.Lens
import Data.Default
import qualified Data.Text as T
import Frontend.Components.Button
import Frontend.Components.Card
import Frontend.Components.SVG.ArrowUpRight
import Frontend.Pages.App.Overview.RiskLevelProgress
import Frontend.Utils
import Reflex.Dom hiding (button)
import Text.Printf

data LoanData = LoanData
  { _availableBorrowingPower :: Double
  , _currentBorrowed :: Double
  , _interestRate :: Double
  , _healthFactor :: Double
  , _totalCollateralValueUSD :: Double
  , _totalAmountOwed :: Double
  } deriving (Eq, Ord)

instance Default LoanData where
  def = LoanData 0.0 0.0 0.0 0.0 0.0 0.0

makeLenses ''LoanData

getTextColor :: Double -> (Int, Int, Int)
getTextColor hf =
  if hf == 0.0
    then (0, 255, 0)
    else let clamped = min 10.0 $ max 1.0 hf
             ratio = (clamped - 1.0) / 9.0
             red = round $ 255.0 * (1-ratio)
             green = round $ 255.0 * ratio
          in (red, green, 0)

calculateRiskLevel :: LoanData -> Double
calculateRiskLevel LoanData{..} =
  if _totalCollateralValueUSD == 0.0 || _totalAmountOwed == 0.0
    then 0.0
    else let risk = (_totalAmountOwed * 10000.0) / (_totalCollateralValueUSD * 100.0)
          in min 100.0 risk

borrowingSection :: MonadWidget t m => Dynamic t LoanData -> m ()
borrowingSection = withDyn_ $ \loanData -> card (constDyn "border border-gray-100 shadow-sm") $ do
  cardHeader (constDyn "flex flex-col sm:flex-row sm:items-center sm:justify-between pb-2 space-y-2 sm:space-y-0") $ do
    el "div" $ do
      cardTitle (constDyn "text-xl font-bold") $
        text "My Borrowing"
      cardDescription (constDyn "text-gray-500") $
        text "Leverage your assets with secured loans"
    elClass "div" "hidden sm:block" $
      button (constDyn $ def & bpClassName .~ "flex items-center gap-2") $ do
        arrowUpRight $ def & svg_size .~ 16
        text "Start Borrowing"
  cardContent (constDyn "") $
    elClass "div" "py-4" $
      elClass "div" "space-y-6" $ do
        riskLevelProgress . constDyn $ calculateRiskLevel loanData
        elClass "div" "flex flex-col gap-2 mt-8" $ do
          elClass "div" "flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-0" $ do
            elClass "span" "text-gray-600 text-sm sm:text-base" $
              text "Available Borrowing Power"
            elClass "span" "font-semibold text-sm sm:text-base" $
              text $ T.pack (printf "%.02f" $ loanData ^. availableBorrowingPower) <> " USDST"
        elClass "div" "flex flex-col gap-2 mt-8" $ do
          elClass "div" "flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-0" $ do
            elClass "span" "text-gray-600 text-sm sm:text-base" $
              text "Total Amount Owed"
            elClass "span" "font-semibold text-sm sm:text-base" $
              text $ T.pack (printf "%.02f" $ loanData ^. currentBorrowed) <> " USDST"
        elClass "div" "flex flex-col gap-2 mt-8" $ do
          elClass "div" "flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-0" $ do
            elClass "span" "text-gray-600 text-sm sm:text-base" $
              text "Interest Rate"
            elClass "span" "font-semibold text-sm sm:text-base" $
              text $ T.pack (printf "%.02f" $ (loanData ^. interestRate) / 100) <> "%"
        elClass "div" "flex flex-col gap-2 mt-8" $ do
          elClass "div" "flex flex-col sm:flex-row sm:justify-between gap-1 sm:gap-0" $ do
            elClass "span" "text-gray-600 text-sm sm:text-base" $
              text "Health Factor"
            elAttr "span" (
                   "class" =: "font-semibold text-sm sm:text-base"
                <> "style" =: ("color: rgb" <> T.pack (show . getTextColor $ loanData ^. healthFactor) <> ";") 
              ) $
              if loanData ^. healthFactor == 0.0
                then text "No Loan"
                else text . T.pack . printf "%.02f" $ loanData ^. healthFactor
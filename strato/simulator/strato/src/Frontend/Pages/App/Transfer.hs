{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Frontend.Pages.App.Transfer where

import Data.Default
import qualified Data.Text as T
import Frontend.Components.Button
import Frontend.Components.Input
import Frontend.Types.State hiding (Transaction(..))
import Reflex.Dom hiding (button)
import Text.Printf

appTransfer :: MonadWidget t m => Dynamic t AppState -> m ()
appTransfer _ = elClass "main" "p-6" $ do
  elClass "div" "max-w-2xl mx-auto bg-white shadow-md rounded-lg p-6 space-y-6" $ do
    elClass "h2" "text-xl font-semibold" $
      text "Transfer your tokens"
    elClass "div" "space-y-2" $ do
      elClass "label" "text-sm text-gray-600" $
        text "Token"
      blank -- TODO: Popover
    elClass "div" "space-y-2" $ do
      elClass "label" "text-sm text-gray-600" $
        text "Recipient Address"
      _ <- input def
      blank -- TODO: recipientError
    elClass "div" "space-y-2" $ do
      elClass "label" "text-sm text-gray-600" $
        text "Amount"
      _ <- input def
      blank -- TODO: amountError
      blank -- TODO: feeError
    elClass "div" "bg-gray-50 p-4 rounded-lg" $
      elClass "div" "flex justify-between text-sm" $ do
        elClass "span" "text-gray-600" $
          text "Transaction Fee"
        elClass "span" "font-medium" $
          text $ T.pack (printf "%.02f" (0.01 :: Double)) <> " USDST (" <> T.pack (show (1 :: Int)) <> " voucher)"
    button (constDyn $ def & bpClassName .~ "w-full")
      $ text "Transfer" -- TODO: Processing...
    
    blank -- TODO: TransferConfirmationModal
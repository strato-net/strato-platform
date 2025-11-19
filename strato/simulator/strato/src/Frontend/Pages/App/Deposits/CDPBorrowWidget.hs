{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Frontend.Pages.App.Deposits.CDPBorrowWidget where

import Control.Lens
import Frontend.Components.Select
import Reflex.Dom hiding (button, select)

cdpBorrowWidget :: MonadWidget t m => m ()
cdpBorrowWidget = elClass "div" "flex flex-col gap-6 w-full" $ do
  el "style" $
    text "\
    \/* Hide number input arrows */                     \
    \input[type=\"number\"]::-webkit-outer-spin-button, \
    \input[type=\"number\"]::-webkit-inner-spin-button {\
    \  -webkit-appearance: none;                        \
    \  margin: 0;                                       \
    \}                                                  \
    \input[type=\"number\"] {                           \
    \  -moz-appearance: textfield;                      \
    \}"
  elClass "h2" "text-xl font-semibold text-gray-900" $
    text "Borrow Against Collateral"
  elClass "div" "grid grid-cols-1 lg:grid-cols-2 gap-4" $ do
    elClass "div" "border border-gray-200 rounded-xl p-4 space-y-4" $ do
      elClass "div" "flex items-center justify-between" $
        elClass "h3" "font-semibold" $ do
          text "Deposit "
          elClass "span" "text-sm text-gray-500 font-normal" blank
      let st = def
            & st_class       .~ "w-full"
            & st_placeholder ?~ "Select collateral asset"
      select st []
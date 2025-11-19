{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Frontend.Pages.App.Borrow where

import Reflex.Dom
import Frontend.Components.Card
import Frontend.Components.Tabs

data BorrowTab = Borrow | Repay
  deriving (Eq, Ord)

appBorrow :: MonadWidget t m => m ()
appBorrow = elClass "main" "p-6" $ do
  elClass "div" "grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8" $ do
    card (constDyn "") $ do
      cardHeader (constDyn "") $
        cardTitle (constDyn "") $
          text "Borrow & Repay"
      cardContent (constDyn "") $ do
        tabs (constDyn "w-full") $ mdo
          let focusOn p = (==p) <$> tabDyn
          e <- tabsList (constDyn "grid w-full grid-cols-2") $ do
            (e1, _) <- tabsTrigger' (constDyn "") (focusOn Borrow) $ text "Borrow"
            (e2, _) <- tabsTrigger' (constDyn "") (focusOn Repay) $ text "Repay"
            pure $ leftmost
              [ Borrow <$ domEvent Click e1
              , Repay  <$ domEvent Click e2
              ]
          tabDyn <- holdDyn Borrow e
          dyn_ . ffor tabDyn $ \case
            Borrow -> tabsContent (constDyn "") $
              text "BorrowForm" -- TODO: BorrowForm
            Repay  -> tabsContent (constDyn "") $
              text "RepayForm" -- TODO: RepayForm
    el "div" $
      text "PositionSection" -- TODO: PositionSection
  text "CollateralManagementTable" -- TODO: CollateralManagementTable

  text "CollateralModal" -- TODO: CollateralModal
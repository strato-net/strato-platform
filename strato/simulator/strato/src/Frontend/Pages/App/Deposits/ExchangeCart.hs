{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecursiveDo #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Frontend.Pages.App.Deposits.ExchangeCart where

import Frontend.Components.Button
import Frontend.Components.SVG.History
import Frontend.Components.Tabs
import Frontend.Pages.App.Deposits.CDPBorrowWidget
import Reflex.Dom hiding (button)

data ExchangeCartTab = CdpTab | BridgeTab | SwapTab | ConvertTab
  deriving (Eq, Ord)

data CDPTab = CdpVaults | CdpBadDebt | CdpLiquidations
  deriving (Eq, Ord)

data ConvertTab = ConvertDeposit | ConvertWithdraw
  deriving (Eq, Ord)

exchangeCart :: MonadWidget t m => ExchangeCartTab -> m ()
exchangeCart initialTab = elClass "div" "w-full bg-white shadow-md rounded-2xl p-4 space-y-5 font-sans" $ do
  el "style" $
    text "\
    \.custom-tabs .ant-tabs-tab {         \
    \  justify-content: center !important;\
    \}                                    \
    \.custom-tabs .ant-tabs-tab-btn {     \
    \  justify-content: center !important;\
    \  text-align: center !important;     \
    \  width: 100% !important;            \
    \}"
  tabs (constDyn "w-full") $ mdo
    let tab d p = (==p) <$> d
    e <- tabsList (constDyn "grid w-full grid-cols-4") $ do
      (e1, _) <- tabsTrigger' (constDyn "") (tabDyn `tab` CdpTab) $ text "Borrow"
      (e2, _) <- tabsTrigger' (constDyn "") (tabDyn `tab` BridgeTab) $ text "Bridge"
      (e3, _) <- tabsTrigger' (constDyn "") (tabDyn `tab` SwapTab) $ text "Swap"
      (e4, _) <- tabsTrigger' (constDyn "") (tabDyn `tab` ConvertTab) $ text "Convert"
      pure $ leftmost
        [ CdpTab     <$ domEvent Click e1
        , BridgeTab  <$ domEvent Click e2
        , SwapTab    <$ domEvent Click e3
        , ConvertTab <$ domEvent Click e4
        ]
    tabDyn <- holdDyn initialTab e
    dyn_ . ffor tabDyn $ \case
      CdpTab -> tabsContent (constDyn "") . elClass "div" "w-full" $ do
        elClass "div" "flex items-center justify-between mb-4" $
          elClass "h2" "text-lg font-semibold text-gray-900" $
            text "Borrow"
        tabs (constDyn "w-full bg-white/90 p-1.5 rounded-xl border border-gray-200 shadow-sm") $ mdo
          cdpTab <- tabsList (constDyn "grid w-full grid-cols-3") $ do
            (e1, _) <- tabsTrigger' (constDyn "") (cdpTabDyn `tab` CdpVaults) $ text "Vaults"
            (e2, _) <- tabsTrigger' (constDyn "") (cdpTabDyn `tab` CdpBadDebt) $ text "Bad Debt"
            (e3, _) <- tabsTrigger' (constDyn "") (cdpTabDyn `tab` CdpLiquidations) $ text "Liquidations"
            pure $ leftmost
              [ CdpVaults       <$ domEvent Click e1
              , CdpBadDebt      <$ domEvent Click e2
              , CdpLiquidations <$ domEvent Click e3
              ]
          cdpTabDyn <- holdDyn CdpVaults cdpTab
          elClass "div" "bg-white rounded-xl p-4 shadow-sm mt-4" $
            dyn_ . ffor cdpTabDyn $ \case
              CdpVaults -> elClass "div" "space-y-6" $ do
                elClass "div" "border-2 border-gray-300 rounded-xl p-4 pb-[60px] flex flex-col" $
                  cdpBorrowWidget
                blank -- TODO: VaultsList
              CdpBadDebt -> blank -- TODO: BadDebtView
              CdpLiquidations -> blank -- TODO: LiquidationsView
      BridgeTab -> tabsContent (constDyn "") $ blank -- TODO: BridgeWidget
      SwapTab -> tabsContent (constDyn "") . elClass "div" "border-2 border-gray-300 rounded-xl p-4 pb-[60px] flex flex-col" $
        blank -- TODO: SwapWidget
      ConvertTab -> tabsContent (constDyn "") . elClass "div" "w-full" $ do
        elClass "div" "flex items-center justify-between mb-4" $ do
          elClass "h2" "text-lg font-semibold text-gray-900" $
            text "USDST"
          button (constDyn $ def
              & bpVariant   .~ BVGhost
              & bpSize      .~ BSSmall
              & bpClassName .~ "flex items-center gap-2"
            ) $ do
            history $ def & svg_class .~ "h-4 w-4"
            text "View Transactions"
        tabs "w-full bg-white/90 p-1.5 rounded-xl border border-gray-200 shadow-sm" $ mdo
          convertTab <- tabsList (constDyn "grid w-full grid-cols-2") $ do
            (e1, _) <- tabsTrigger' (constDyn "") (convertTabDyn `tab` ConvertDeposit) $ text "Deposit"
            (e2, _) <- tabsTrigger' (constDyn "") (convertTabDyn `tab` ConvertWithdraw) $ text "Withdraw"
            pure $ leftmost
              [ ConvertDeposit  <$ domEvent Click e1
              , ConvertWithdraw <$ domEvent Click e2
              ]
          convertTabDyn <- holdDyn ConvertDeposit convertTab
          elClass "div" "bg-white rounded-xl p-4 shadow-sm mt-4" $
            dyn_ . ffor convertTabDyn $ \case
              ConvertDeposit -> elClass "div" "mb-4" $ do
                elClass "h3" "text-lg font-semibold text-center" $
                  text "Get USDST"
                elClass "p" "text-sm text-gray-600 text-center" $
                  text "Bridge stablecoins and get USDST"
                blank -- TODO: MintWidget
              ConvertWithdraw -> elClass "div" "mb-4" $ do
                elClass "h3" "text-lg font-semibold text-center" $
                  text "Redeem to Stablecoins"
                elClass "p" "text-sm text-gray-600 text-center" $
                  text "Redeem USDST back to external stablecoins"
                blank -- TODO: WithdrawWidget
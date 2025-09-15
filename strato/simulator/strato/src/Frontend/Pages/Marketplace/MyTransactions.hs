{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Frontend.Pages.Marketplace.MyTransactions where

import Common.BridgeClient (fetchMarketplaceTransactions)
import Common.Types
import qualified Data.Text as T
import Frontend.Components.Badge
import Frontend.Types.State hiding (Transaction(..))
import Frontend.Utils
import Reflex.Dom

myTransactionsWidget :: MonadWidget t m => Dynamic t AppState -> m ()
myTransactionsWidget _ = elClass "div" "transactions-tab" $ do
  el "h2" $ text "My Transactions"
  txsDyn <- holdDyn [] =<< backendGET fetchMarketplaceTransactions =<< getPostBuild
  dyn_ $ ffor txsDyn $ \txs ->
    elClass "table" "transactions-table" $ do
      el "thead" $ el "tr" $ mapM_ (el "th" . text)
        ["#", "Type", "Asset", "Quantity", "Price", "Buyer", "Seller", "Hash", "Date", "Status"]
      el "tbody" $ mapM_ renderTx txs

renderTx :: MonadWidget t m => Transaction -> m ()
renderTx tx = el "tr" $ do
  el "td" $ text $ "#" <> T.pack (show $ txId tx)
  el "td" $ elClass "badge" (badgeClass (txType tx)) $ text (txType tx)
  el "td" $ do
    elAttr "img" ("src" =: txImageUrl tx <> "class" =: "asset-icon") blank
    text $ txAsset tx
  el "td" $ text $ T.pack (show $ txQuantity tx)
  el "td" $ text $ maybe "--" (T.pack . show) $ txPrice tx
  el "td" $ text $ txBuyer tx
  el "td" $ text $ txSeller tx
  el "td" $ maybe (text "--") (\h -> elAttr "a" ("href" =: ("#/" <> h)) $ text ("#" <> T.take 6 h <> "...")) $ txHash tx
  el "td" $ text $ txDate tx
  el "td" $ elClass "badge" (badgeClass (txStatus tx)) $ text (txStatus tx)
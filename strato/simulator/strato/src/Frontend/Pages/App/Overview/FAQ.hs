{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Pages.App.Overview.FAQ where

import Data.Foldable (for_)
import Data.Text (Text)
import Frontend.Components.Accordion
import Reflex.Dom

faqs :: [(Text, Text)]
faqs =
  [ ("What assets can I deposit?"
    , "You can deposit various assets including gold, silver, and cryptocurrencies like Ethereum and wrapped Bitcoin. Each asset has different yield opportunities and borrowing capabilities."
    )
  , ( "How does borrowing work?"
    , "You can borrow against your deposited assets. The amount you can borrow depends on the collateralization ratio of each asset. Keep your risk level below 80% to avoid liquidation."
    )
  , ( "What are CATA Rewards?"
    , "CATA points is the reward system on STRATO Mercata. Points are rewarded based on your deposits and platform activity."
    )
  , ( "How secure are my assets?"
    , "All deposited assets are secured through multiple layers of security including third-party audits, multi-signature wallets, and insurance coverage. Physical assets are stored in high-security vaults with regular audits."
    )
  , ( "What is the liquidation process?"
    , "If your risk level exceeds the liquidation threshold (typically 80%), a portion of your collateral may be liquidated to maintain the health of your position. You'll receive notifications as you approach this threshold."
    )
  ]

dashboardFAQ :: MonadWidget t m => m ()
dashboardFAQ = elClass "div" "bg-white rounded-xl border border-gray-100 p-5 shadow-sm" $ do
  elClass "h2" "font-bold text-lg mb-4" $
    text "Frequently Asked Questions"
  el "div" . for_ faqs $ \(q, a) -> accordionItem
    (AccordionTrigger "text-left font-medium" $ text q)
    (AccordionContent "text-gray-600" $ text a)
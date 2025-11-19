{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.Wallet
  ( wallet
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

wallet :: MonadWidget t m => SVGProps -> m ()
wallet = flip svg $ do
  elSvgAttr "path" ("d" =: "M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1") $ blank
  elSvgAttr "path" ("d" =: "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4") $ blank
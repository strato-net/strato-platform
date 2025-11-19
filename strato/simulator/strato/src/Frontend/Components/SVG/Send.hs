{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.Send
  ( send
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

send :: MonadWidget t m => SVGProps -> m ()
send = flip svg $ do
  elSvgAttr "path" ("d" =: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z") $ blank
  elSvgAttr "path" ("d" =: "m21.854 2.147-10.94 10.939") $ blank
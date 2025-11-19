{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.Plus
  ( plus
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

plus :: MonadWidget t m => SVGProps -> m ()
plus = flip svg $ do
  elSvgAttr "path" ("d" =: "M5 12h14") $ blank
  elSvgAttr "path" ("d" =: "M12 5v14") $ blank
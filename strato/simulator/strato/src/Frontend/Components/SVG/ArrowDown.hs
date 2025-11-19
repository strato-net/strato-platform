{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.ArrowDown
  ( arrowDown
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

arrowDown :: MonadWidget t m => SVGProps -> m ()
arrowDown = flip svg $ do
  elSvgAttr "path" ("d" =: "M12 5v14") $ blank
  elSvgAttr "path" ("d" =: "m19 12-7 7-7-7") $ blank
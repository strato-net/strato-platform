{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.SVG.Vote
  ( vote
  , module Frontend.Components.SVG
  ) where

import Reflex.Dom
import Frontend.Components.SVG

vote :: MonadWidget t m => SVGProps -> m ()
vote = flip svg $ do
  elSvgAttr "path" ("d" =: "m9 12 2 2 4-4") $ blank
  elSvgAttr "path" ("d" =: "M5 7c0-1.1.9-2 2-2h10a2 2 0 0 1 2 2v12H5V7Z") $ blank
  elSvgAttr "path" ("d" =: "M22 19H2") $ blank
{-# LANGUAGE MonoLocalBinds #-}
{-# LANGUAGE OverloadedStrings #-}

module Frontend.Components.Spinner (spinner) where

import Reflex.Dom

spinner :: MonadWidget t m => m ()
spinner = elClass "div" "inline-block w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" blank
{-# LANGUAGE TemplateHaskell   #-}


module BlockApps.Bloc22.Server.BlocOptions where

import           HFlags

defineFlag "useDeprecatedFillFailBehavior" (True :: Bool) "don't return an error when gas is off and user tries to fill gas (just fail silently).  This options is only included for backwards compatibility"

{-# LANGUAGE CPP, LambdaCase, OverloadedStrings, TemplateHaskell #-}
module SolidVM.BuiltinSource (lookupActionSource) where

import SolidVM.Builtins hiding (lookupAction)
import SolidVM.BuiltinQuotation (builtinActions)
import SolidVM.Core
import qualified Data.Text as T

$(builtinActions [d|
#include "BuiltinActions.inc"
  |])

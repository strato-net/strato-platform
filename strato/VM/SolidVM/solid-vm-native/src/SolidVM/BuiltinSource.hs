{-# LANGUAGE CPP, LambdaCase, OverloadedStrings, TemplateHaskell #-}
module SolidVM.BuiltinSource (lookupActionSource) where

import SolidVM.Builtins hiding (lookupAction)
import SolidVM.BuiltinQuotation (builtinActions)
import qualified Data.Text as T
import Language.Haskell.TH (Exp)

lookupActionSource :: T.Text -> Maybe Exp
lookupActionSource = $(builtinActions [|
#include "BuiltinActions.inc"
  |])

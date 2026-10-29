{-# LANGUAGE DataKinds #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}

{-# OPTIONS_GHC -Wno-orphans #-}

module Blockchain.SolidVM.Builtins
  ( -- * Monadic ABI functions (need MonadSM)
    encodeDynamicValue,
    abiEncode,
    abiEncodePacked,

    push,
    module Blockchain.SolidVM.Builtins.Crypto,
  )
where

import Blockchain.SolidVM.Builtins.Crypto
import qualified Blockchain.SolidVM.Builtins.Collections.Metered as Builtin
import Blockchain.SolidVM.Execution (Interpreted, MonadValueOperations (..))
import Blockchain.SolidVM.SetGet
import Blockchain.SolidVM.SM
import Blockchain.SolidVM.Builtins.ABI.Values (encodeDynamicValue)
import Blockchain.SolidVM.Builtins.ABI.Values.Metered
import SolidVM.Model.Value

instance MonadValueOperations Interpreted SM where
  forceBuiltinValue = forceValue
  showBuiltinValue = showSM
  readBuiltinInteger = getInt
  writeBuiltinVariable = setVar

-- Pushes a new value to an array and returns the length of the new array
push :: MonadSM m => Value -> Maybe Variable -> ValList -> m Variable
push = Builtin.push @Interpreted

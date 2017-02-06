{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE FlexibleInstances #-}

module SolidityStateTranslate where

import SolidityStateTypes
import ProcessSimpleTypes
import ProcessComplexTypes

import qualified Data.Map as Map
import qualified Data.Vector as VV

import Numeric.Natural

import Blockchain.Ethereum.Solidity.Parse
import Blockchain.Ethereum.Solidity.Layout

import Data.Maybe


{-

From the Solidity Docs:

Statically-sized variables (everything except mapping and dynamically-sized array types)
are laid out contiguously in storage starting from position 0. Multiple items that need
less than 32 bytes are packed into a single storage slot if possible, according to the following rules:

0: The first item in a storage slot is stored lower-order aligned.
1: Elementary types use only that many bytes that are necessary to store them.
2: If an elementary type does not fit the remaining part of a storage slot, 
it is moved to the next storage slot.
3: Structs and array data always start a new slot and occupy whole slots 
(but items inside a struct or array are packed tightly according to these rules).
4: The elements of structs and arrays are stored after each other, just as if they 
were given explicitly.

-}

translateState :: SolidityFile -> SolidityUnlabeledState -> SolidityLabeledState
translateState file unlabeled = 
  Prelude.foldr 
    (`labelVariable` unlabeled)
    (SolidityLabeledState Map.empty Nothing) 
    (extractVariables file)

labelVariable :: SolidityStateVariable -> SolidityUnlabeledState -> SolidityLabeledState -> SolidityLabeledState
labelVariable var unlabeled old = 
  old { 
    labeledState = 
      Map.insert 
        var 
        (
          solidityValueLabel 
            var 
            (
              findRelevantStorage
                var 
                unlabeled
            )
        )
        (labeledState old)
  }


solidityValueLabel :: SolidityStateVariable -> Map.Map StorageKey StorageValue -> SolidityStateValue
solidityValueLabel (PrimitiveVariable pv) state = PrimitiveValue $ primitiveValueLabel pv state
solidityValueLabel (ComplexVariable cv) state = ComplexValue $ complexValueLabel cv state





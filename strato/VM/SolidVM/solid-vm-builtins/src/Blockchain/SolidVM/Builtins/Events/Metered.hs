module Blockchain.SolidVM.Builtins.Events.Metered (emit) where

import qualified Blockchain.SolidVM.Builtins.Events as Original
import Blockchain.SolidVM.Builtins.Operations.Metered (dataWrite)
import Blockchain.SolidVM.Builtins.Size.Values (valueSize)
import Blockchain.SolidVM.SM (SM)
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.SolidString (SolidString)
import SolidVM.Model.Value (Value)

-- | An event is permanent data, so it is priced as a storage write of its arguments.
emit :: (Value -> SM Value) -> Bool -> CC.Contract -> String -> SolidString -> [Value] -> SM ()
emit force defaultUnwritten contract statement eventName values =
  dataWrite (sum (map valueSize values)) >> Original.emit force defaultUnwritten contract statement eventName values

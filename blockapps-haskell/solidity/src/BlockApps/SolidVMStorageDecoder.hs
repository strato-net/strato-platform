module BlockApps.SolidVMStorageDecoder where

import qualified Data.Text as T
import BlockApps.Solidity.SolidityValue
import Blockchain.SolidVM.Model

decodeSolidVMValues :: [(HexStorage, HexStorage)] -> [(T.Text, SolidityValue)]
decodeSolidVMValues = error "TODO(tim): decodeSolidVMValues"

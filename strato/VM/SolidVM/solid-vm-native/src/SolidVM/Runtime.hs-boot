{-# LANGUAGE DataKinds, TypeFamilies #-}
module SolidVM.Runtime where

import Blockchain.SolidVM.SM (SM)
import Blockchain.Strato.Model.Address (Address)
import qualified Data.ByteString as B
import qualified Data.Text as T
import SolidVM.Core (CallKind, Dyn, SomeTy, Sig, Fn)
import SolidVM.Model.Storable (StoragePath)

internalFrame :: T.Text -> Sig args r -> Fn args r -> Fn args r
messageSignature :: SM T.Text
messageArguments :: SM [Dyn]
callContract :: CallKind -> Address -> T.Text -> [Dyn] -> Maybe SomeTy -> SM [Dyn]
encodeArguments :: Bool -> [Dyn] -> SM B.ByteString
createCode :: Maybe Dyn -> T.Text -> T.Text -> [Dyn] -> SM Address
derive :: Address -> T.Text -> T.Text -> [Dyn] -> SM Address
createContract :: T.Text -> Maybe (SM Dyn) -> SM [Dyn] -> SM Address
copyStorage :: StoragePath -> StoragePath -> SM ()
emitContractEvent :: T.Text -> T.Text -> [(T.Text, Dyn)] -> SM ()
previousBlock :: SM (Address, Address, Integer)
proposer :: SM Address

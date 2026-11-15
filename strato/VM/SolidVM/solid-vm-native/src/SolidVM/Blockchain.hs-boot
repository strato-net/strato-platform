{-# LANGUAGE ConstraintKinds, TypeFamilies #-}
module SolidVM.Blockchain where

import Blockchain.SolidVM.SM (SM, MonadSM)
import Blockchain.Strato.Model.Address (Address)
import Blockchain.Data.ProposalFacts (ProposalFacts)
import qualified Data.Text as T
import qualified SolidVM.Model.CodeCollection as CC
import SolidVM.Model.Value (Value, ValList)

call' :: Address -> Address -> CC.FunctionCallType -> T.Text -> ValList -> SM (Maybe Value)
createContractValues :: T.Text -> Maybe (SM Value) -> SM ValList -> SM Address
createCode :: Maybe Value -> T.Text -> T.Text -> ValList -> SM Address
selfdestruct :: Address -> SM Bool
derive :: Address -> T.Text -> T.Text -> ValList -> SM Address
getPrevBlockFacts :: MonadSM m => m ProposalFacts

{-# LANGUAGE OverloadedStrings #-}

module Blockchain.SolidVM.Value where


import           Data.ByteString (ByteString)
import qualified Data.ByteString as B
import           Data.IORef
import           Data.Map (Map)
import qualified Data.Map as M
import           Data.Vector (Vector)
import qualified Data.Vector as V

import           Blockchain.Data.Address
import           Blockchain.Data.RLP

import qualified SolidVM.Model.Storable           as MS
import qualified SolidVM.Solidity.Xabi            as Xabi
import qualified SolidVM.Solidity.Xabi.Type       as Xabi


data IndexType = ArrayIndex | MapBoolIndex | MapAddressIndex | MapIntIndex | MapStringIndex deriving (Show, Eq)

data Variable = Variable (IORef Value)
  | Property String Variable
  | Constant Value
  | StorageItem MS.StoragePath

instance Show Variable where
  show (Variable _) = "<variable>"
  show (Property name o) = "<prop:" ++ name ++ "> of " ++ show o
  show (Constant v) = "Constant: " ++ show v
  show (StorageItem key) = "<storage: " ++ show key ++ ">"

--TODO- we need to figure out this ambiguity on the Address types....
--Sometimes address is and integer (solidity can treat an integer as an address),
--sometimes it is a proper type.

data Value =
  SInteger Integer
  | SString String
  | SBool Bool
  | SAddress Address
  | SEnum String
  | SEnumVal String String
  | SStructDef String
  | SStruct String (Map String Variable)
  | STuple (Vector Variable)
  | SArray Xabi.Type (Vector Variable)
  | SMap Xabi.Type (Map Value Variable)
  | SFunction Xabi.Func
  | SBuiltinFunction String (Maybe Value)
  | SBuiltinVariable String
  | SSetterGetter String (Maybe Value)
  | SContractDef String
  | SContractItem Integer String
  | SContract String Integer --second param is address
  | SContractFunction String Integer String -- contractName, address, functionName
  | SNULL
  | SDefault -- TODO(tim): The default value, but does not yet have a type hint
             -- It would be better to have `fromBasic :: Type -> BasicValue -> Value`,
  | SReference MS.StoragePath -- An alias to an existing variable, so that modifications
                              -- can be canonicalized
  deriving (Show)


--TODO- Remove this sloppy half-measure of Ord, Eq definitions once we move to Solidity static typing
--This only allows for comparison within the same type of values
--(the move to static typing will probably automatically clean this up)

instance Eq Value where
  (SInteger i1) == (SInteger i2) = i1 == i2
  (SString s1) == (SString s2) = s1 == s2
  (SBool b1) == (SBool b2) = b1 == b2
  x == y = error $ "(==) not defined for Values given:\n" ++ show x ++ "\n" ++ show y

instance Ord Value where
  compare (SInteger i1) (SInteger i2) = compare i1 i2
  compare (SString s1) (SString s2) = compare s1 s2
  compare (SBool b1) (SBool b2) = compare b1 b2
  compare x y = error $ "Ord not defined for Values given:\n" ++ show x ++ "\n" ++ show y


instance RLPSerializable Value where
  rlpEncode (SInteger i) = RLPArray [RLPString "I", rlpEncode i]
  rlpEncode (SString s) = RLPArray [RLPString "S", rlpEncode s]
  rlpEncode x = error $ "undefined case in rlpEncode for Value: " ++ show x

  rlpDecode (RLPArray [RLPString "I", i]) = SInteger $ rlpDecode i
  rlpDecode (RLPArray [RLPString "S", s]) = SString $ rlpDecode s
  rlpDecode x = error $ "undefined case in rlpDecode for Value: " ++ show x

nullMatch :: Value -> Value -> Bool
nullMatch SDefault = \case
  SBool False -> True
  SInteger 0 -> True
  SString "" -> True
  SAddress 0x0 -> True
  SEnumVal e v -> error $ "TODO(tim): cannot yet determine 0 of an enum:" ++ show (e, v)
  _ -> False
nullMatch _ = const False

valEquals :: Value -> Value -> Bool
valEquals lhs rhs =
     nullMatch lhs rhs
  || nullMatch rhs lhs
  || case (lhs, rhs) of
           (SInteger i1, SInteger i2) -> i1 == i2
           (SString s1, SString s2) -> s1 == s2
           (SBool b1, SBool b2) -> b1 == b2
           (SAddress v1, SAddress v2) -> v1 == v2
           (SEnumVal e1 v1, SEnumVal e2 v2) -> (e1 == e2) && (v1 == v2)

--Meh, Solidity doesn't recognize a difference between Address and Integer....
           (SAddress (Address v1), SInteger v2) -> v1 == fromInteger v2
           (SInteger v1, SAddress (Address v2)) -> fromInteger v1 == v2
           (SBuiltinVariable v1, SBuiltinVariable v2) ->
             error $ "Comparison of builtin vars requires evaluation: " ++ show (v1, v2)
           _ -> error $ "unsupported type combination in valEquals: " ++ show (lhs, rhs)


defaultValue :: Xabi.Type -> Value
defaultValue (Xabi.Array valType _) = SArray valType V.empty
defaultValue (Xabi.Mapping _ _ valType) = SMap valType $ M.empty
defaultValue (Xabi.Int _ _) = SInteger 0
defaultValue Xabi.Bool = SBool False
defaultValue (Xabi.Address) = SAddress $ Address 0
defaultValue (Xabi.String _) = SString ""
defaultValue (Xabi.Bytes _ _) = SString ""
defaultValue (Xabi.Label name) = SString $ "Label: " ++ name  --TODO- clearly this is wrong.......  I just need something here to run the program through to the end, this needs to be fixed later
defaultValue x = error $ "missing type in defaultValue: " ++ show x





byteStringToValue :: ByteString -> Maybe Value
byteStringToValue x | x == B.singleton 128 = Nothing
byteStringToValue x = Just . SInteger . rlpDecode . rlpDeserialize $ x

castToInt :: Value -> Integer
castToInt (SInteger i) = i
castToInt SDefault = 0
castToInt s = error $ "cast: not an integer: " ++ show s

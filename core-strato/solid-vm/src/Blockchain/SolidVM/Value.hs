{-# LANGUAGE OverloadedStrings #-}

module Blockchain.SolidVM.Value where

import           Control.Monad
import           Control.Monad.IO.Class
import           Data.ByteString (ByteString)
import qualified Data.ByteString as B
import           Data.IORef
import           Data.Map (Map)
import qualified Data.Map as M
import           Data.Maybe
import           Data.Traversable
import           Data.Vector (Vector)
import qualified Data.Vector as V

import qualified BlockApps.Solidity.Xabi            as Xabi
import qualified BlockApps.Solidity.Xabi.Type       as Xabi
import           Blockchain.Data.RLP
import           Blockchain.Data.Address

data Variable = Variable (IORef Value)
  | Property String Variable
  | Constant Value
  | UnsetMapItem Variable Value Xabi.Type
  | StorageItem String
  
instance Show Variable where
  show (Variable _) = "<variable>"
  show (Property name o) = "<prop:" ++ name ++ "> of " ++ show o
  show (Constant v) = "Constant: " ++ show v
  show (UnsetMapItem _ key valType) = "<unsetmapitem: " ++ show key ++ ">, type =" ++ show valType
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
  | SNULL deriving (Show)


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
  rlpEncode x = error $ "undefined case in rlpEncode for Value: " ++ show x
  
  rlpDecode (RLPArray [RLPString "I", i]) = SInteger $ rlpDecode i
  rlpDecode x = error $ "undefined case in rlpDecode for Value: " ++ show x

varEquals :: MonadIO m =>
             Variable -> Variable -> m Bool
varEquals (Variable v1) (Variable v2) = do
  res1 <- liftIO $ readIORef v1
  res2 <- liftIO $ readIORef v2
  valEquals res1 res2
varEquals _ _ = error "varEquals is not yet defined for Properties...."


valEquals :: MonadIO m =>
             Value -> Value -> m Bool
valEquals (SInteger i1) (SInteger i2) = return $ i1 == i2
valEquals (SString s1) (SString s2) = return $ s1 == s2
valEquals (SBool b1) (SBool b2) = return $ b1 == b2
valEquals (SAddress v1) (SAddress v2) = return $ v1 == v2
valEquals (SEnum v1) (SEnum v2) = return $ v1 == v2
valEquals (SEnumVal e1 v1) (SEnumVal e2 v2) = return $ (e1 == e2) && (v1 == v2)
valEquals (SStructDef v1) (SStructDef v2) = return $ v1 == v2
valEquals (SStruct n1 m1) (SStruct n2 m2) = do
  let fieldNames1 = M.keys m1
      fieldNames2 = M.keys m2
  if (n1 == n2 && fieldNames1 == fieldNames2)
    then do
      results <- 
        forM fieldNames1 $ \fieldName -> do
          let var1 = fromMaybe (error $ "Internal error in valEquals- key in map")
                     $ M.lookup fieldName m1
              var2 = fromMaybe (error $ "Internal error in valEquals- key in map")
                     $ M.lookup fieldName m2
          varEquals var1 var2
      return $ and results
    else return False
    
valEquals (STuple vec1) (STuple vec2) = do
  if V.length vec1 == V.length vec2
    then do
      results <-
        for (V.zip vec1 vec2) $ \(var1, var2) -> do
        varEquals var1 var2
      return $ and results
    else return False
  
valEquals (SArray _ vec1) (SArray _ vec2) = do
  if V.length vec1 == V.length vec2
    then do
      results <-
        for (V.zip vec1 vec2) $ \(var1, var2) -> do
        varEquals var1 var2
      return $ and results
    else return False
valEquals (SFunction v1) (SFunction v2) = return $ v1 == v2
valEquals (SBuiltinFunction v1 maybeO1) (SBuiltinFunction v2 maybeO2) = do
  case (maybeO1, maybeO2) of
    (Just o1, Just o2) -> do
      result <- valEquals o1 o2
      return $ result && v1 == v2
    (Nothing, Nothing) -> return $ v1 == v2
    _ -> return False
valEquals (SBuiltinVariable v1) (SBuiltinVariable v2) = return $ v1 == v2
valEquals (SContractDef v1) (SContractDef v2) = return $ v1 == v2
valEquals (SAddress (Address v1)) (SInteger v2) = return $ v1 == fromInteger v2 --Meh, Solidity doesn't recognize a difference between Address and Integer....
valEquals (SInteger v1) (SAddress (Address v2)) = return $ fromInteger v1 == v2
valEquals _ _ = return False


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

{-# LANGUAGE GADTs, OverloadedStrings, LambdaCase, CPP, RankNTypes, DataKinds, TypeOperators #-}
-- Builtins are ordinary actions. Selection happens while compiling the call.
module SolidVM.Builtins where

import Blockchain.SolidVM.SM (SM)
import Blockchain.Data.RLP
import qualified Blockchain.SolidVM.Exception as E
import Blockchain.Strato.Model.Address (Address (..))
import Control.Exception (throwIO)
import Control.Monad.Reader
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.Decimal
import Data.Foldable (toList)
import Data.List (sortOn)
import qualified Data.Text as T
import {-# SOURCE #-} qualified SolidVM.Runtime as Runtime
import {-# SOURCE #-} qualified SolidVM.Blockchain as Blockchain
import SolidVM.Core
import qualified Blockchain.SolidVM.Builtins.Casts as Casts
import qualified Blockchain.SolidVM.Builtins.Functions.Metered as Metered
import qualified Blockchain.SolidVM.Builtins.Casts.Metered as MeteredCasts
import qualified Blockchain.SolidVM.Builtins.Operations.Metered as Operations
import qualified Blockchain.SolidVM.Builtins.ABI as ABI
import qualified Blockchain.SolidVM.Builtins.ABI.Values.Metered as MeteredABI

flatten :: [Dyn] -> [Dyn]
flatten ds = case reverse ds of
  Dyn TVariadic rest : xs -> reverse xs ++ rest
  _ -> ds

bad :: T.Text -> [Dyn] -> SM a
bad name ds = liftIO $ throwIO $ E.InvalidArguments (T.unpack name) (show (map showDyn ds))

missingUserCert :: SM a
missingUserCert = liftIO $ throwIO $ E.UnknownVariable "not found" "getUserCert"

invalidLowLevel :: [Dyn] -> SM a
invalidLowLevel ds = liftIO $ throwIO $ E.TypeError "low-level call needs first argument to be a string" (show (map showDyn ds))

modular :: (Integer -> Integer -> Integer -> SM Integer) -> [Dyn] -> SM Dyn
modular op ds = case flatten ds of
  [Dyn TInt a, Dyn TInt b, Dyn TInt c] -> Dyn TInt <$> op a b c
  xs -> bad "modular arithmetic expects three integers" xs

invalidCast :: T.Text -> Ty a -> a -> SM b
invalidCast name t value = liftIO $ throwIO $ E.InvalidArguments (T.unpack name) (show [formatValue t value])

parseInteger :: T.Text -> Integer -> SM Integer
parseInteger value base = MeteredCasts.int (value, base)

integer :: [Dyn] -> SM Dyn
integer ds = fmap (Dyn TInt) $ case flatten ds of
  [Dyn t value] -> integerValue t value
  [Dyn TStr value, Dyn TInt base] -> parseInteger value base
  xs -> bad "integer cast" xs

decimal :: [Dyn] -> SM Dyn
decimal ds = case flatten ds of
  [Dyn t value] -> Dyn TDecimal <$> decimalValue t value
  xs -> bad "decimal cast" xs

address :: [Dyn] -> SM Dyn
address ds = case flatten ds of
  [Dyn t value] -> Dyn TAddr <$> addressValue t value
  xs -> bad "address cast" xs

string :: [Dyn] -> SM Dyn
string ds = fmap (Dyn TStr) $ case flatten ds of
  [Dyn t value] -> stringValue t value
  [Dyn TInt value, Dyn TInt base] -> stringBase value base
  [Dyn TInt value, Dyn TInt base, Dyn TInt width] -> stringWidth value base width
  [Dyn TBytes value, Dyn TStr encoding] -> stringEncoding value encoding
  xs -> bad "string cast" xs

encode :: Bool -> [Dyn] -> SM Dyn
encode packed ds = do
  let values = flatten ds
  Operations.invokeSized values $ Dyn TBytes <$> Runtime.encodeArguments packed values

destroy :: [Dyn] -> SM Dyn
destroy ds = case flatten ds of
  [Dyn t value] -> Dyn TBool <$> destroyValue t value
  xs -> bad "selfdestruct" xs

create :: Bool -> [Dyn] -> SM Dyn
create salted ds = case (salted, flatten ds) of
  (False, Dyn TStr name : Dyn TStr source : args) -> deploy Nothing name source args
  (True, salt : Dyn TStr name : Dyn TStr source : args) -> deploy (Just salt) name source args
  (_, xs) -> bad "create expects contract name and source" xs
  where
    deploy salt name source args
      | T.null name || T.null source = bad "empty contract name or source" ds
      | otherwise = do
          Dyn TAddr <$> Runtime.createCode salt name source args

derive :: Address -> [Dyn] -> SM Address
derive creator ds = case flatten ds of
  Dyn TStr salt : Dyn TStr name : args -> do
    Runtime.derive creator salt name args
  xs -> bad "derive expects salt and contract name" xs

recover :: [Dyn] -> SM Dyn
recover ds = case flatten ds of
  [Dyn ht h, Dyn TInt v, Dyn rt' r, Dyn st s] -> Dyn TAddr <$> recoverValue ht rt' st h v r s
  xs -> bad "ecrecover" xs

keccak :: [Dyn] -> SM Dyn
keccak ds = case flatten ds of
  [Dyn TBytes bs] -> Dyn TBytes <$> Metered.keccak256 bs
  xs -> Dyn TStr <$> keccakValue (encodeValues xs)

encodeValues :: [Dyn] -> RLPObject
encodeValues [d] = encodeValue d
encodeValues ds = RLPArray (map encodeValue ds)

encodeValue :: Dyn -> RLPObject
encodeValue (Dyn ty v) = case ty of
  TInt -> rlpEncode v
  TDecimal -> rlpEncode (show v)
  TBool -> rlpEncode v
  TAddr -> rlpEncode v
  TStr -> rlpEncode (T.unpack v)
  TBytes -> rlpEncode v
  TEnum _ _ -> rlpEncode (enumNumber v)
  TWireEnum _ _ -> rlpEncode v
  TStruct _ fs -> RLPArray (map (encodeValue . snd) (sortOn fst (fields fs v)))
  TTuple fs -> RLPArray (map encodeValue (toDyns fs v))
  TArr et -> RLPArray (map (encodeValue . Dyn et) (toList v))
  TWireArray -> RLPArray (map encodeValue v)
  TVariadic -> encodeValues v
  TRaw -> case v of [] -> rlpEncode (0 :: Integer); _ -> encodeValues v
  TUnit -> rlpEncode (0 :: Integer)
  TRef _ -> rlpEncode (0 :: Integer)
  _ -> RLPArray []
  where
    fields :: Fields ts -> HL ts -> [(T.Text, Dyn)]
    fields FNil HNil = []
    fields (FCons n t rest) (x :* xs) = (n, Dyn t x) : fields rest xs

addmodValue, mulmodValue :: Integer -> Integer -> Integer -> SM Integer
addmodValue = Metered.addmod
mulmodValue = Metered.mulmod

integerValue :: Ty a -> a -> SM Integer
integerValue t = case t of
  TInt -> MeteredCasts.int
  TEnum _ _ -> MeteredCasts.int . enumNumber
  TDecimal -> MeteredCasts.int
  TStr -> MeteredCasts.int
  TBytes -> MeteredCasts.int
  TAddr -> MeteredCasts.int
  TUnit -> MeteredCasts.int
  TRef _ -> const $ MeteredCasts.int ()
  _ -> invalidCast "integer cast" t

decimalValue :: Ty a -> a -> SM Decimal
decimalValue t = case t of
  TInt -> MeteredCasts.decimal
  TDecimal -> MeteredCasts.decimal
  TStr -> MeteredCasts.decimal
  TUnit -> MeteredCasts.decimal
  TRef _ -> const $ MeteredCasts.decimal ()
  _ -> invalidCast "decimal cast" t

addressValue :: Ty a -> a -> SM Address
addressValue t = case t of
  TAddr -> MeteredCasts.address
  TContract _ -> MeteredCasts.address
  TInt -> MeteredCasts.address
  TBytes -> MeteredCasts.address
  TStr -> MeteredCasts.address
  TUnit -> MeteredCasts.address
  TRef _ -> const $ MeteredCasts.address ()
  _ -> invalidCast "address cast" t

stringValue :: Ty a -> a -> SM T.Text
stringValue t = case t of
  TStr -> MeteredCasts.string
  TAddr -> MeteredCasts.string
  TInt -> MeteredCasts.string
  TBool -> MeteredCasts.string
  TBytes -> MeteredCasts.string
  TUnit -> MeteredCasts.string
  TRef _ -> const $ MeteredCasts.string ()
  _ -> invalidCast "string cast" t

stringBase :: Integer -> Integer -> SM T.Text
stringBase value base = MeteredCasts.string (value, base)

stringWidth :: Integer -> Integer -> Integer -> SM T.Text
stringWidth value base width = MeteredCasts.string (value, base, width)

stringEncoding :: B.ByteString -> T.Text -> SM T.Text
stringEncoding value encoding = MeteredCasts.string (value, encoding)

recoverValue :: Ty h -> Ty r -> Ty s -> h -> Integer -> r -> s -> SM Address
recoverValue ht rt' st = recoverTyped (recoverFunction ht) (integerValue rt') (integerValue st)

recoverFunction :: Ty h -> h -> SM (Integer -> Integer -> Integer -> SM Address)
recoverFunction t = case t of
  TBytes -> pure . Metered.ecrecover
  TInt -> pure . Metered.ecrecover
  TAddr -> pure . Metered.ecrecover
  TStr -> pure . Metered.ecrecover
  TUnit -> pure . Metered.ecrecover
  _ -> invalidCast "ecrecover hash" t

recoverTyped :: (h -> SM (Integer -> Integer -> Integer -> SM Address)) -> (r -> SM Integer) -> (s -> SM Integer) -> h -> Integer -> r -> s -> SM Address
recoverTyped prepare rArg sArg h v r s = do
  function <- prepare h
  rValue <- rArg r
  sValue <- sArg s
  function v rValue sValue

destroyValue :: Ty a -> a -> SM Bool
destroyValue t value = addressValue t value >>= destroyAddress

destroyAddress :: Address -> SM Bool
destroyAddress = Blockchain.selfdestruct

createValue :: T.Text -> T.Text -> [Dyn] -> SM Address
createValue name source args = deployValue Nothing name source (flatten args)

createSaltedValue :: Ty a -> a -> T.Text -> T.Text -> [Dyn] -> SM Address
createSaltedValue t salt name source args = deployValue (Just $ Dyn t salt) name source (flatten args)

deployValue :: Maybe Dyn -> T.Text -> T.Text -> [Dyn] -> SM Address
deployValue salt name source args
  | T.null name || T.null source = bad "empty contract name or source" $
      maybe id (:) salt [Dyn TStr name, Dyn TStr source] ++ args
  | otherwise = do
      Runtime.createCode salt name source args

keccakValue :: RLPObject -> SM T.Text
keccakValue = fmap T.pack . Metered.keccak256Hex

-- These factories select and compose typed encoders once, while compiling.
rlpEncoder :: Ty a -> a -> RLPObject
rlpEncoder t = case t of
  TInt -> rlpEncode
  TDecimal -> rlpEncode . show
  TBool -> rlpEncode
  TAddr -> rlpEncode
  TStr -> rlpEncode . T.unpack
  TBytes -> rlpEncode
  TEnum _ _ -> rlpEncode . enumNumber
  TWireEnum _ _ -> rlpEncode
  TStruct _ fields -> fieldEncoder $ map snd $ sortOn fst $ rlpFields fields
  TTuple fields -> fieldEncoder $ map snd $ rlpFields fields
  TArr element -> let encodeElement = rlpEncoder element in encodeElement `seq` RLPArray . map encodeElement . toList
  TVariadic -> encodeValues
  TRaw -> \values -> case values of [] -> rlpEncode (0 :: Integer); _ -> encodeValues values
  TWireArray -> RLPArray . map encodeValue
  TUnit -> const $ rlpEncode (0 :: Integer)
  TRef _ -> const $ rlpEncode (0 :: Integer)
  _ -> const $ RLPArray []
  where
    fieldEncoder :: [b -> RLPObject] -> b -> RLPObject
    fieldEncoder encoders = let encodeFields = combine encoders in encodeFields `seq` RLPArray . encodeFields
    combine :: [b -> RLPObject] -> b -> [RLPObject]
    combine [] = const []
    combine (encodeField : encoders) =
      let next = combine encoders
      in encodeField `seq` next `seq` \values -> encodeField values : next values

rlpFields :: Fields as -> [(T.Text, HL as -> RLPObject)]
rlpFields FNil = []
rlpFields (FCons name t fields) =
  let encodeField = rlpEncoder t
      first = encodeField `seq` \(value :* _) -> encodeField value
      tailField :: (HL bs -> RLPObject) -> HL (b ': bs) -> RLPObject
      tailField encodeTail = encodeTail `seq` \(_ :* values) -> encodeTail values
  in (name, first) : [(n, tailField encoder) | (n, encoder) <- rlpFields fields]

abiEncoder :: Bool -> Ty a -> a -> SM (Bool, B.ByteString)
abiEncoder packed t = case t of
  TInt -> scalar ABI.encodeInt256
  TBool -> scalar $ \b -> if packed then B.singleton (if b then 1 else 0) else ABI.encodeUint256 (if b then 1 else 0)
  TAddr -> \value -> do
    encoded <- Casts.bytes value
    pure (False, (if packed then id else ABI.padLeft32) encoded)
  TEnum _ _ -> scalar $ ABI.encodeUint256 . enumNumber
  TWireEnum _ _ -> scalar ABI.encodeUint256
  TBytes -> dynamic id
  TStr -> dynamic $ BC.pack . T.unpack
  TArr element ->
    let encodeElement = abiEncoder packed element
    in encodeElement `seq` \values -> do
      fields <- traverse encodeElement $ toList values
      let encoded = if packed then ABI.abiEncodePacked (map snd fields) else ABI.abiEncode fields
      pure (not packed, if packed then encoded else ABI.encodeDynamicArray (length fields) encoded)
  TRaw -> unknown t
  TWireArray -> unknown t
  TAlias _ _ -> const $ diverge "native alias escaped"
  TMaybe _ -> const $ diverge "native internal value escaped"
  _ -> const $ pure (False, if packed then B.empty else ABI.encodeUint256 0)
  where
    scalar :: (b -> B.ByteString) -> b -> SM (Bool, B.ByteString)
    scalar encodeScalar = \value -> pure (False, encodeScalar value)
    dynamic :: (b -> B.ByteString) -> b -> SM (Bool, B.ByteString)
    dynamic bytes = \value -> pure (not packed, (if packed then id else ABI.encodeDynamicBytes) (bytes value))
    unknown :: Ty b -> b -> SM (Bool, B.ByteString)
    unknown ty = \value -> do
      let d = Dyn ty value
      encoded <- Runtime.encodeArguments packed [d]
      let isDynamic = not packed && dynamicValue d
      pure (isDynamic, if isDynamic then B.drop 32 encoded else encoded)
    dynamicValue :: Dyn -> Bool
    dynamicValue (Dyn ty value) = case ty of
      TBytes -> True
      TStr -> True
      TArr _ -> True
      TWireArray -> True
      TRaw -> case value of [d] -> dynamicValue d; _ -> False
      _ -> False

abiArguments :: Bool -> Fields args -> HL args -> SM B.ByteString
abiArguments packed fields = withArgumentTuple fields $ \tuple ->
  let encoder = arguments (abiEncoder packed) fields
   in encoder `seq` \values -> MeteredABI.encodeArguments packed (tuple values) (encoder values)

arguments :: (forall a. Ty a -> a -> SM result) -> Fields args -> HL args -> SM [result]
arguments _ FNil = const $ pure []
arguments convert (FCons _ t fields) =
  let first = convert t
      remaining = arguments convert fields
  in first `seq` remaining `seq` \(value :* values) -> (:) <$> first value <*> remaining values

rlpArgument :: Ty a -> a -> SM RLPObject
rlpArgument t = let encoder = rlpEncoder t in encoder `seq` pure . encoder

rlpArguments :: [RLPObject] -> RLPObject
rlpArguments [value] = value
rlpArguments values = RLPArray values

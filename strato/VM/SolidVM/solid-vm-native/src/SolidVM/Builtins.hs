{-# LANGUAGE GADTs, OverloadedStrings, LambdaCase, CPP, RankNTypes, DataKinds, TypeOperators #-}
-- Builtins are ordinary actions. Selection happens while compiling the call.
module SolidVM.Builtins where

import Blockchain.Data.RLP
import qualified Blockchain.SolidVM.Exception as E
import Blockchain.Strato.Model.Address (Address (..))
import Blockchain.Strato.Model.Keccak256
import Control.Exception (evaluate, throwIO)
import Control.Monad.Reader
import qualified Data.ByteString as B
import qualified Data.ByteString.Char8 as BC
import Data.Decimal
import Data.Foldable (toList)
import Data.List (sortOn)
import qualified Data.Text as T
import SolidVM.Core
import qualified Blockchain.SolidVM.Builtins.Casts as Casts
import qualified Blockchain.SolidVM.Builtins.Functions as Shared
import qualified Blockchain.SolidVM.Builtins.ABI as ABI

flatten :: [Dyn] -> [Dyn]
flatten ds = case reverse ds of
  Dyn TVariadic rest : xs -> reverse xs ++ rest
  _ -> ds

bad :: T.Text -> [Dyn] -> M a
bad name ds = liftIO $ throwIO $ E.InvalidArguments (T.unpack name) (show (map showDyn ds))

missingUserCert :: M a
missingUserCert = liftIO $ throwIO $ E.UnknownVariable "not found" "getUserCert"

invalidLowLevel :: [Dyn] -> M a
invalidLowLevel ds = liftIO $ throwIO $ E.TypeError "low-level call needs first argument to be a string" (show (map showDyn ds))

modular :: (Integer -> Integer -> Integer -> Integer) -> [Dyn] -> M Dyn
modular op ds = case flatten ds of
  [Dyn TInt a, Dyn TInt b, Dyn TInt c] -> Dyn TInt <$> modularValue op a b c
  xs -> bad "modular arithmetic expects three integers" xs

castResult :: Casts.CastResult a -> M a
castResult = either (\(name, values) -> liftIO $ throwIO $ E.InvalidArguments name (show values)) pure

invalidCast :: T.Text -> Ty a -> a -> M b
invalidCast name t value = liftIO $ throwIO $ E.InvalidArguments (T.unpack name) (show [formatValue t value])

parseInteger :: T.Text -> Integer -> M Integer
parseInteger value base = castResult $ Casts.int (value, base)

integer :: [Dyn] -> M Dyn
integer ds = fmap (Dyn TInt) $ case flatten ds of
  [Dyn t value] -> integerValue t value
  [Dyn TStr value, Dyn TInt base] -> parseInteger value base
  xs -> bad "integer cast" xs

decimal :: [Dyn] -> M Dyn
decimal ds = case flatten ds of
  [Dyn t value] -> Dyn TDecimal <$> decimalValue t value
  xs -> bad "decimal cast" xs

address :: [Dyn] -> M Dyn
address ds = case flatten ds of
  [Dyn t value] -> Dyn TAddr <$> addressValue t value
  xs -> bad "address cast" xs

string :: [Dyn] -> M Dyn
string ds = fmap (Dyn TStr) $ case flatten ds of
  [Dyn t value] -> stringValue t value
  [Dyn TInt value, Dyn TInt base] -> stringBase value base
  [Dyn TInt value, Dyn TInt base, Dyn TInt width] -> stringWidth value base width
  [Dyn TBytes value, Dyn TStr encoding] -> stringEncoding value encoding
  xs -> bad "string cast" xs

encode :: Bool -> [Dyn] -> M Dyn
encode packed ds = do
  runtime <- rt
  Dyn TBytes <$> liftIO (rtAbiEncode runtime packed (flatten ds))

destroy :: [Dyn] -> M Dyn
destroy ds = case flatten ds of
  [Dyn t value] -> Dyn TBool <$> destroyValue t value
  xs -> bad "selfdestruct" xs

create :: Bool -> [Dyn] -> M Dyn
create salted ds = case (salted, flatten ds) of
  (False, Dyn TStr name : Dyn TStr source : args) -> deploy Nothing name source args
  (True, salt : Dyn TStr name : Dyn TStr source : args) -> deploy (Just salt) name source args
  (_, xs) -> bad "create expects contract name and source" xs
  where
    deploy salt name source args
      | T.null name || T.null source = bad "empty contract name or source" ds
      | otherwise = do
          runtime <- rt
          Dyn TAddr <$> liftIO (rtCreateCode runtime salt name source args)

derive :: Address -> [Dyn] -> M Address
derive creator ds = case flatten ds of
  Dyn TStr salt : Dyn TStr name : args -> do
    runtime <- rt
    liftIO (rtDerive runtime creator salt name args)
  xs -> bad "derive expects salt and contract name" xs

recover :: [Dyn] -> M Dyn
recover ds = case flatten ds of
  [Dyn ht h, Dyn TInt v, Dyn rt' r, Dyn st s] -> Dyn TAddr <$> recoverValue ht rt' st h v r s
  xs -> bad "ecrecover" xs

keccak :: [Dyn] -> M Dyn
keccak ds = case flatten ds of
  [Dyn TBytes bs] -> pure (Dyn TBytes (keccak256ToByteString (hash bs)))
  xs -> pure (Dyn TStr (T.pack (keccak256ToHex (hash (rlpSerialize (encodeValues xs))))))

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

addmodValue, mulmodValue :: Integer -> Integer -> Integer -> M Integer
addmodValue = modularValue Shared.addmod
mulmodValue = modularValue Shared.mulmod

modularValue :: (Integer -> Integer -> Integer -> Integer) -> Integer -> Integer -> Integer -> M Integer
modularValue op a b c = liftIO $ evaluate (op a b c)

integerValue :: Ty a -> a -> M Integer
integerValue t = case t of
  TInt -> castResult . Casts.int
  TEnum _ _ -> castResult . Casts.int . enumNumber
  TDecimal -> castResult . Casts.int
  TStr -> castResult . Casts.int
  TBytes -> castResult . Casts.int
  TAddr -> castResult . Casts.int
  TUnit -> castResult . Casts.int
  TRef _ -> const $ castResult $ Casts.int ()
  _ -> invalidCast "integer cast" t

decimalValue :: Ty a -> a -> M Decimal
decimalValue t = case t of
  TInt -> castResult . Casts.decimal
  TDecimal -> castResult . Casts.decimal
  TStr -> castResult . Casts.decimal
  TUnit -> castResult . Casts.decimal
  TRef _ -> const $ castResult $ Casts.decimal ()
  _ -> invalidCast "decimal cast" t

addressValue :: Ty a -> a -> M Address
addressValue t = case t of
  TAddr -> castResult . Casts.address
  TContract _ -> castResult . Casts.address
  TInt -> castResult . Casts.address
  TBytes -> castResult . Casts.address
  TStr -> castResult . Casts.address
  TUnit -> castResult . Casts.address
  TRef _ -> const $ castResult $ Casts.address ()
  _ -> invalidCast "address cast" t

stringValue :: Ty a -> a -> M T.Text
stringValue t = case t of
  TStr -> castResult . Casts.string
  TAddr -> castResult . Casts.string
  TInt -> castResult . Casts.string
  TBool -> castResult . Casts.string
  TBytes -> castResult . Casts.string
  TUnit -> castResult . Casts.string
  TRef _ -> const $ castResult $ Casts.string ()
  _ -> invalidCast "string cast" t

stringBase :: Integer -> Integer -> M T.Text
stringBase value base = castResult $ Casts.string (value, base)

stringWidth :: Integer -> Integer -> Integer -> M T.Text
stringWidth value base width = castResult $ Casts.string (value, base, width)

stringEncoding :: B.ByteString -> T.Text -> M T.Text
stringEncoding value encoding = castResult $ Casts.string (value, encoding)

recoverValue :: Ty h -> Ty r -> Ty s -> h -> Integer -> r -> s -> M Address
recoverValue ht rt' st = recoverTyped (recoverFunction ht) (integerValue rt') (integerValue st)

recoverFunction :: Ty h -> h -> M (Integer -> Integer -> Integer -> Address)
recoverFunction t = case t of
  TBytes -> pure . Shared.ecrecover
  TInt -> pure . Shared.ecrecover
  TAddr -> pure . Shared.ecrecover
  TStr -> pure . Shared.ecrecover
  TUnit -> pure . Shared.ecrecover
  _ -> invalidCast "ecrecover hash" t

recoverTyped :: (h -> M (Integer -> Integer -> Integer -> Address)) -> (r -> M Integer) -> (s -> M Integer) -> h -> Integer -> r -> s -> M Address
recoverTyped prepare rArg sArg h v r s = do
  function <- prepare h
  function v <$> rArg r <*> sArg s

destroyValue :: Ty a -> a -> M Bool
destroyValue t value = addressValue t value >>= destroyAddress

destroyAddress :: Address -> M Bool
destroyAddress addr = do
  runtime <- rt
  liftIO $ rtSelfdestruct runtime addr

createValue :: T.Text -> T.Text -> [Dyn] -> M Address
createValue name source args = deployValue Nothing name source (flatten args)

createSaltedValue :: Ty a -> a -> T.Text -> T.Text -> [Dyn] -> M Address
createSaltedValue t salt name source args = deployValue (Just $ Dyn t salt) name source (flatten args)

deployValue :: Maybe Dyn -> T.Text -> T.Text -> [Dyn] -> M Address
deployValue salt name source args
  | T.null name || T.null source = bad "empty contract name or source" $
      maybe id (:) salt [Dyn TStr name, Dyn TStr source] ++ args
  | otherwise = do
      runtime <- rt
      liftIO $ rtCreateCode runtime salt name source args

keccakValue :: RLPObject -> M T.Text
keccakValue = pure . T.pack . Shared.keccak256Hex

encodeArgumentsValue :: Bool -> [(Bool, B.ByteString)] -> M B.ByteString
encodeArgumentsValue packed = pure . if packed then ABI.abiEncodePacked . map snd else ABI.abiEncode

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

abiEncoder :: Bool -> Ty a -> a -> M (Bool, B.ByteString)
abiEncoder packed t = case t of
  TInt -> scalar ABI.encodeInt256
  TBool -> scalar $ \b -> if packed then B.singleton (if b then 1 else 0) else ABI.encodeUint256 (if b then 1 else 0)
  TAddr -> \value -> do
    encoded <- castResult $ Casts.bytes value
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
    scalar :: (b -> B.ByteString) -> b -> M (Bool, B.ByteString)
    scalar encodeScalar = \value -> pure (False, encodeScalar value)
    dynamic :: (b -> B.ByteString) -> b -> M (Bool, B.ByteString)
    dynamic bytes = \value -> pure (not packed, (if packed then id else ABI.encodeDynamicBytes) (bytes value))
    unknown :: Ty b -> b -> M (Bool, B.ByteString)
    unknown ty = \value -> do
      let d = Dyn ty value
      runtime <- rt
      encoded <- liftIO $ rtAbiEncode runtime packed [d]
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

arguments :: (forall a. Ty a -> a -> M result) -> Fields args -> HL args -> M [result]
arguments _ FNil = const $ pure []
arguments convert (FCons _ t fields) =
  let first = convert t
      remaining = arguments convert fields
  in first `seq` remaining `seq` \(value :* values) -> (:) <$> first value <*> remaining values

rlpArgument :: Ty a -> a -> M RLPObject
rlpArgument t = let encoder = rlpEncoder t in encoder `seq` pure . encoder

rlpArguments :: [RLPObject] -> RLPObject
rlpArguments [value] = value
rlpArguments values = RLPArray values

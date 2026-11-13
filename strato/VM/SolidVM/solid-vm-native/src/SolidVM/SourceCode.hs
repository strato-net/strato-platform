{-# LANGUAGE GADTs, OverloadedStrings, FlexibleInstances, TemplateHaskell, ExistentialQuantification, LambdaCase, ScopedTypeVariables, CPP, DataKinds, TypeOperators #-}
-- Inspection representations are never used by the executable compiler.
module SolidVM.SourceCode where

import Blockchain.SolidVM.SM (SM)
import SolidVM.Core hiding (Fun(..))
import qualified SolidVM.Core as Core
import Data.Char (ord, isAscii, isAlphaNum)
import Numeric (showHex)
import Language.Haskell.TH hiding (Code)
import Data.Data (Data, cast, gmapT, gmapQ)
import qualified Data.Text as T
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.Text.Encoding as TE
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
import SolidVM.Model.CodeCollection (Func, funcArgs)
import Control.Lens ((^.))
import qualified Data.Sequence
import qualified Data.Foldable as Foldable
import Data.Decimal
import Data.IORef (IORef)
import Control.Monad (void)
import Blockchain.Strato.Model.Address (Address(..))
import SolidVM.Model.Storable (StoragePath(..), StoragePathPiece(..))

-- The executable field lets the shared compiler retain its existing Haskell
-- types. Inspection only demands the expression field, never executes it.
data Code a = Code { runCode :: a, sourceExpression :: Exp, codeName :: Maybe T.Text, codeType :: Maybe Type, codeForm :: Form a }

-- Check the executable template's type without compiling a second executable.
-- Inspection uses its expression and compiler facts, never this field.
inspectionOnly :: a -> a
inspectionOnly _ = error "inspection code cannot be executed"
{-# INLINE inspectionOnly #-}

#include "ActionCode.inc"

captureCode :: Code a -> (Code a -> Code b) -> Code b
captureCode code continuation = continuation code

captureCode2 :: Code a -> Code b -> (Code a -> Code b -> Code result) -> Code result
captureCode2 a b continuation = continuation a b

captureCode3 :: Code a -> Code b -> Code c -> (Code a -> Code b -> Code c -> Code result) -> Code result
captureCode3 a b c continuation = continuation a b c

captureCode4 :: Code a -> Code b -> Code c -> Code d -> (Code a -> Code b -> Code c -> Code d -> Code result) -> Code result
captureCode4 a b c d continuation = continuation a b c d

captureCodes :: [Code a] -> (Code [a] -> Code b) -> Code b
captureCodes codes continuation = continuation (listCode codes)

constantFunction :: Code b -> Code (a -> b)
constantFunction code = Code (const (runCode code)) (LamE [WildP] (toSource code)) Nothing Nothing (ConstantFunction code)

pureAction :: Applicative m => Code a -> Code (m a)
pureAction code = Code (pure (runCode code)) (AppE (VarE 'pure) (toSource code)) Nothing Nothing (PureAction code)

withForm :: Form a -> Code a -> Code a
withForm form code = code { codeForm = form }

actionFunction :: Monad m => Code (Action env m a) -> Code (env -> m a)
actionFunction code = Code (runAction (runCode code))
  (AppE (VarE 'runAction) (toSource (actionProgram code))) Nothing Nothing (ActionFunction (actionProgram code))

actionResidual :: Code (env -> m a) -> Code (Action env m a)
actionResidual code = Code (contextAction (runCode code))
  (AppE (VarE 'contextAction) (toSource code)) Nothing Nothing Ordinary

actionLiftResidual :: Code (m a) -> Code (Action env m a)
actionLiftResidual code = Code (liftAction (runCode code))
  (AppE (VarE 'liftAction) (toSource code)) Nothing Nothing (LiftedComputation code)

actionProgram :: Code (Action env m a) -> Code (Action env m a)
actionProgram code = code { sourceExpression = LetE [PragmaD (LineP 0 "solidvm-action")] (sourceExpression code) }

actionReturn :: Monad m => Code a -> Code (Action env m a)
actionReturn code = Code (pure (runCode code)) (AppE (VarE 'pure) (toSource code)) Nothing Nothing (PureComputation code)

actionCharge :: Integer -> Code (Action env SM ())
actionCharge gas = Code (inspectionOnly undefined) (AppE (VarE 'chargeAction) (toSource gas)) Nothing Nothing Ordinary

actionStore :: Ty a -> Code StoragePath -> Code a -> Code (Action env SM ())
actionStore ty path value = Code (inspectionOnly undefined)
  (AppE (AppE (AppE (VarE 'storeAction) (toSource ty)) (toSource path)) (toSource value)) Nothing Nothing Ordinary

referenceAction :: Ix ls (IORef a) -> Code (Action (Env ls) SM a)
referenceAction index = Code (inspectionOnly undefined) (AppE (VarE 'readReference) (toSource index)) Nothing Nothing Ordinary

valueAction :: Ix ls a -> Code (Action (Env ls) SM a)
valueAction index = Code (inspectionOnly undefined) (AppE (VarE 'valueAt) (toSource index)) Nothing Nothing Ordinary

actionAfter :: Integer -> Code (Action env SM a) -> Code (Action env SM a)
actionAfter gas code = Code (inspectionOnly undefined)
  (AppE (AppE (VarE 'chargeActionAfter) (toSource gas)) (toSource code)) Nothing Nothing Ordinary

actionThenResidual :: Code (Action env SM a) -> Code (Action env SM b) -> Code (Action env SM b)
actionThenResidual first second = Code (inspectionOnly undefined)
  (DoE Nothing [NoBindS (toSource first), NoBindS (toSource second)]) Nothing Nothing Ordinary

actionPureResidual :: Code (env -> a) -> Code (Action env SM a)
actionPureResidual code = Code (inspectionOnly undefined)
  (AppE (AppE (VarE 'fmap) (toSource code)) (VarE 'askEnvironment)) Nothing Nothing Ordinary

actionWritePath :: Ty a -> Code StoragePath -> Code (env -> a) -> Code (Action env SM ())
actionWritePath ty path value = emitContextWrite ty (toSource path) (AppE (toSource value) (VarE (mkName "frame")))

actionWriteValue :: Ty a -> Code (env -> StoragePath) -> Code a -> Code (Action env SM ())
actionWriteValue ty path value = emitContextWrite ty (AppE (toSource path) (VarE (mkName "frame"))) (toSource value)

actionWriteResidual :: Ty a -> Code (env -> StoragePath) -> Code (env -> a) -> Code (Action env SM ())
actionWriteResidual ty path value = emitContextWrite ty
  (AppE (toSource path) (VarE (mkName "frame"))) (AppE (toSource value) (VarE (mkName "frame")))

emitContextWrite :: Ty a -> Exp -> Exp -> Code (Action env SM ())
emitContextWrite ty path value = Code (inspectionOnly undefined)
  (AppE (VarE 'contextAction) (LamE [VarP (mkName "frame")]
    (AppE (AppE (AppE (VarE 'writeVal) (toSource ty)) path) value))) Nothing Nothing Ordinary

applyResidual :: Code (a -> b) -> Code a -> Code b
applyResidual function argument = Code (runCode function (runCode argument))
  (AppE (toSource function) (toSource argument)) Nothing Nothing Ordinary

bindResidual :: Code (SM a) -> Code (a -> SM b) -> Code (SM b)
bindResidual first continuation = Code (inspectionOnly undefined)
  (InfixE (Just (toSource first)) (VarE '(>>=)) (Just (toSource continuation))) Nothing Nothing Ordinary

mapResidual :: Code (a -> b) -> Code (SM a) -> Code (SM b)
mapResidual function action = Code (inspectionOnly undefined)
  (AppE (AppE (VarE 'fmap) (toSource function)) (toSource action)) Nothing Nothing Ordinary

applyActionResidual :: Code (SM (a -> b)) -> Code (SM a) -> Code (SM b)
applyActionResidual function action = Code (inspectionOnly undefined)
  (InfixE (Just (toSource function)) (VarE '(<*>)) (Just (toSource action))) Nothing Nothing Ordinary

integerCode :: Integer -> Code Integer
integerCode value = withForm (IntegerValue value) (valueCode TInt value)

listCode :: [Code a] -> Code [a]
listCode codes = Code (map runCode codes) (ListE (map toSource codes)) Nothing Nothing Ordinary

sequenceResidual :: [Code (SM a)] -> Code (SM [a])
sequenceResidual codes = Code (inspectionOnly undefined)
  (AppE (VarE 'sequence) (ListE (map toSource codes))) Nothing Nothing Ordinary

unitCode :: Code ()
unitCode = Code () (TupE []) Nothing Nothing UnitValue

emitUnitSteps :: [ActionStep] -> Code (SM ())
emitUnitSteps steps = Code (inspectionOnly undefined) expression Nothing Nothing Ordinary
  where
    expression = case statements steps of
      [NoBindS single] -> single
      result -> DoE Nothing result
    statements [EffectStep action] = [NoBindS (AppE (VarE 'void) (toSource action))]
    statements (step : rest@(_ : _)) = actionStatement step : statements rest
    statements remaining = map actionStatement remaining

emitResultSteps :: [ActionStep] -> Code a -> Code (SM a)
emitResultSteps steps value = emitSteps steps (AppE (VarE 'pure) (toSource value))

emitResidualSteps :: [ActionStep] -> Code (SM a) -> Code (SM a)
emitResidualSteps steps final = emitSteps steps (toSource final)

emitSteps :: [ActionStep] -> Exp -> Code (SM a)
emitSteps steps final = Code (inspectionOnly undefined)
  (DoE Nothing (map actionStatement steps ++ [NoBindS final])) Nothing Nothing Ordinary

actionStatement :: ActionStep -> Stmt
actionStatement (GasStep gas) = NoBindS (AppE (VarE 'chargeGas) (toSource gas))
actionStatement (EffectStep action) = NoBindS (toSource action)
actionStatement (WriteStep ty path value) = NoBindS
  (AppE (AppE (AppE (VarE 'writeVal) (toSource ty)) (toSource path)) (toSource value))

emptyEnvironment :: Code (Env '[])
emptyEnvironment = Code ENil (ConE 'ENil) Nothing Nothing EmptyEnvironment

valueEnvironment :: Code a -> Code (Env ls) -> Code (Env (a ': ls))
valueEnvironment value rest = Code (runCode value :& runCode rest)
  (app '(:&) [toSource value, toSource rest]) Nothing Nothing (ValueEnvironment value rest)

localResidual :: Ix ls a -> Code (Env ls) -> Code a
localResidual index code = Code (localValue index (runCode code))
  (AppE (AppE (VarE 'localValue) (toSource index)) (toSource code)) Nothing Nothing Ordinary

afterResidual :: Integer -> Code (SM a) -> Code (SM a)
afterResidual gas code = Code (inspectionOnly undefined) expression Nothing Nothing Ordinary
  where
    action = mkName "residual_action"
    expression = substitute [(action, toSource code)]
      (AppE (AppE (VarE 'chargeAfter) (toSource gas)) (VarE action))

optionalCode :: Maybe (Code a) -> Code (Maybe a)
optionalCode codes = Code (runCode <$> codes) (toSource codes) Nothing Nothing Ordinary

-- A do block is the syntax for this same right-associated chain of binds.
-- Command expressions remain separate: only bind continuations are expanded.
bindChainResidual :: T.Text -> Code (SM a) -> [Code (a -> SM a)] -> Code (a -> SM b) -> Code (SM b)
bindChainResidual name initial commands final = Code executable expression Nothing Nothing Ordinary
  where
    executable = bindActionChain (runCode initial) (map runCode commands) (runCode final)
    variable index = mkName (T.unpack (T.toLower (T.take 1 name) <> T.drop 1 name) ++ "_" ++ show (index :: Int))
    expression = DoE Nothing $
      BindS (VarP (variable 0)) (toSource initial) :
      [BindS (VarP (variable (index + 1))) (AppE (toSource command) (VarE (variable index))) |
        (index, command) <- zip [0 ..] commands] ++
      [NoBindS (AppE (toSource final) (VarE (variable (length commands))))]

data Fun = forall args r. Fun T.Text (Sig args r) (Code (Fn args r))

makeFun :: T.Text -> Sig args r -> Code (Fn args r) -> Fun
makeFun = Fun

linkedAction :: Code a -> a
linkedAction = runCode

class ToSource a where
  toSource :: a -> Exp

instance ToSource (Code a) where
  toSource code = maybe (sourceExpression code) (SigE (sourceExpression code)) (codeType code)
instance ToSource Integer where toSource = LitE . IntegerL
instance ToSource Int where toSource = LitE . IntegerL . fromIntegral
instance ToSource Bool where toSource True = ConE 'True; toSource False = ConE 'False
instance ToSource T.Text where toSource = LitE . StringL . T.unpack
instance ToSource B.ByteString where toSource b = AppE (VarE 'B.pack) (toSource (map fromIntegral (B.unpack b) :: [Integer]))
instance ToSource Address where toSource (Address a) = AppE (ConE 'Address) (LitE (IntegerL (fromIntegral a)))
instance ToSource Decimal where toSource d = AppE (ConE 'Decimal) (LitE (IntegerL (fromIntegral (decimalPlaces d)))) `AppE` LitE (IntegerL (decimalMantissa d))
instance ToSource a => ToSource [a] where toSource = ListE . map toSource
instance ToSource a => ToSource (Maybe a) where toSource Nothing = ConE 'Nothing; toSource (Just a) = AppE (ConE 'Just) (toSource a)
instance (ToSource a, ToSource b) => ToSource (a,b) where toSource (a,b) = TupE [Just (toSource a),Just (toSource b)]
instance ToSource SomeTy where toSource (SomeTy t) = AppE (ConE 'SomeTy) (toSource t)
instance ToSource SType where
  toSource = \case
    SScalar t -> app 'SScalar [toSource t]
    SMap k v -> app 'SMap [toSource k,toSource v]
    SStruct n fs -> app 'SStruct [toSource n,toSource fs]
    SArray e -> app 'SArray [toSource e]
instance ToSource (Ty a) where
  toSource = \case
    TInt -> ConE 'TInt; TDecimal -> ConE 'TDecimal; TBool -> ConE 'TBool
    TAddr -> ConE 'TAddr; TStr -> ConE 'TStr; TBytes -> ConE 'TBytes; TUnit -> ConE 'TUnit
    TEnum n ns -> app 'TEnum [toSource n,toSource ns]
    TContract n -> app 'TContract [toSource n]
    TArr t -> app 'TArr [toSource t]
    TStruct n fs -> app 'TStruct [toSource n,toSource fs]
    TTuple fs -> app 'TTuple [toSource fs]
    TVariadic -> ConE 'TVariadic; TRaw -> ConE 'TRaw; TWireArray -> ConE 'TWireArray
    TWireEnum n label -> app 'TWireEnum [toSource n,toSource label]
    TAlias t st -> app 'TAlias [toSource t,toSource st]
    TMaybe t -> app 'TMaybe [toSource t]
    TRef st -> app 'TRef [toSource st]
instance ToSource (Fields ts) where
  toSource FNil = ConE 'FNil
  toSource (FCons n t rest) = app 'FCons [toSource n,toSource t,toSource rest]
instance ToSource (Sig args r) where
  toSource (SigNil r) = app 'SigNil [toSource r]
  toSource (SigCons t rest) = app 'SigCons [toSource t,toSource rest]
instance ToSource (Ix ts t) where
  toSource IZ = ConE 'IZ
  toSource (IS i) = app 'IS [toSource i]
instance ToSource StoragePath where toSource (StoragePath xs) = app 'StoragePath [toSource xs]
instance ToSource StoragePathPiece where
  toSource (Field s) = app 'Field [toSource s]
  toSource (Index s) = app 'Index [toSource s]
instance ToSource CallKind where
  toSource Call = ConE 'Call; toSource RawCall = ConE 'RawCall; toSource DelegateCall = ConE 'DelegateCall

app :: Name -> [Exp] -> Exp
app n = foldl AppE (ConE n)

substitute :: [(Name, Exp)] -> Exp -> Exp
substitute values expression =
  let bindings = [ValD (VarP name) (NormalB captured) [] | (name, captured) <- values]
      body = transform strip expression
   in if null bindings then body else LetE (PragmaD (LineP 0 "solidvm-captures") : bindings) body
  where
    strip (AppE (AppE (VarE mapper) (VarE n)) e) | nameBase mapper == "map" && nameBase n == "runCode" = e
    strip (AppE (VarE n) e) | nameBase n == "runCode" = e
    strip e = e

transform :: (Exp -> Exp) -> Exp -> Exp
transform f = go
  where
    go :: Data a => a -> a
    go x = case cast x of
      Just expression -> maybe x id $ cast $ f $ gmapT go (expression :: Exp)
      Nothing -> gmapT go x

replaceFree :: Data a => [(Name, Exp)] -> a -> a
replaceFree = walk
  where
    walk :: Data a => [(Name, Exp)] -> a -> a
    walk values x
      | Just expression <- cast x = maybe x id (cast (expressionWith values expression))
      | Just (Clause patterns body declarations) <- cast x =
          let scoped = without (bound patterns ++ declared declarations) values
           in maybe x id (cast (Clause patterns (walk scoped body) (walk scoped declarations)))
      | Just (Match pattern body declarations) <- cast x =
          let scoped = without (bound pattern ++ declared declarations) values
           in maybe x id (cast (Match pattern (walk scoped body) (walk scoped declarations)))
      | Just (ValD pattern body declarations) <- cast x =
          let scoped = without (bound pattern ++ declared declarations) values
           in maybe x id (cast (ValD pattern (walk scoped body) (walk scoped declarations)))
      | Just (GuardedB branches) <- cast x = maybe x id (cast (GuardedB (map (guardedWith values) branches)))
      | otherwise = gmapT (walk values) x
    guardedWith values (NormalG guard, body) = (NormalG (walk values guard), walk values body)
    guardedWith values (PatG statements, body) =
      let (statements', scoped) = statementsWith values statements
       in (PatG statements', walk scoped body)
    expressionWith values = \case
      VarE name -> maybe (VarE name) id (lookup name values)
      LamE patterns body -> LamE patterns (walk (without (bound patterns) values) body)
      LetE declarations body ->
        let scoped = without (declared declarations) values
         in LetE (walk scoped declarations) (walk scoped body)
      DoE qualifier statements -> DoE qualifier (fst (statementsWith values statements))
      MDoE qualifier statements ->
        MDoE qualifier (fst (statementsWith (without (statementNames statements) values) statements))
      CompE statements -> CompE (fst (statementsWith values statements))
      expression -> gmapT (walk values) expression
    statementsWith values [] = ([], values)
    statementsWith values (statement : rest) =
      let (statement', scoped) = case statement of
            BindS pattern action -> (BindS pattern (walk values action), without (bound pattern) values)
            LetS declarations ->
              let inner = without (declared declarations) values
               in (LetS (walk inner declarations), inner)
            RecS statements ->
              let inner = without (statementNames statements) values
               in (RecS (fst (statementsWith inner statements)), inner)
            ParS groups -> (ParS (map (fst . statementsWith values) groups), without (statementNames (concat groups)) values)
            _ -> (walk values statement, values)
          (rest', final) = statementsWith scoped rest
       in (statement' : rest', final)
    statementNames = concatMap $ \case
      BindS pattern _ -> bound pattern
      LetS declarations -> declared declarations
      RecS statements -> statementNames statements
      ParS groups -> statementNames (concat groups)
      _ -> []
    declared = concatMap $ \case
      ValD pattern _ _ -> bound pattern
      FunD name _ -> [name]
      _ -> []
    without names = filter ((`notElem` names) . fst)
    bound :: Data a => a -> [Name]
    bound x = case cast x of
      Just (VarP name) -> [name]
      Just (AsP name pattern) -> name : bound pattern
      _ -> concat (gmapQ bound x)

literal :: Ty a -> a -> Exp
literal TInt = toSource
literal TDecimal = toSource
literal TBool = toSource
literal TAddr = toSource
literal (TContract _) = toSource
literal TStr = toSource
literal TBytes = toSource
literal TUnit = const (TupE [])
literal (TEnum _ _) = \v -> app 'EnumValue [toSource (enumNumber v),toSource (enumIsNumber v)]
literal TVariadic = toSource
literal TRaw = toSource
literal TWireArray = toSource
literal (TWireEnum _ _) = toSource
literal (TArr t) = AppE (VarE 'Data.Sequence.fromList) . ListE . map (literal t) . Foldable.toList
literal (TStruct _ fs) = literalFields fs
literal (TTuple fs) = literalFields fs
literal (TMaybe t) = maybe (ConE 'Nothing) (AppE (ConE 'Just) . literal t)
literal (TRef _) = toSource
literal (TAlias t _) = either (AppE (ConE 'Left) . toSource) (AppE (ConE 'Right) . literal t)

literalFields :: Fields ts -> HL ts -> Exp
literalFields FNil HNil = ConE 'HNil
literalFields (FCons _ t rest) (value :* values) = app '(:*) [literal t value, literalFields rest values]

instance ToSource Dyn where
  toSource (Dyn t value) = app 'Dyn [toSource t, literal t value]

valueCode :: Ty a -> a -> Code a
valueCode t value = Code value (literal t value) Nothing Nothing Ordinary

constantCode :: Ty a -> a -> Code (b -> SM a)
constantCode t v = constantFunction (pureAction (valueCode t v))

namedCode :: T.Text -> Code a -> Code a
namedCode n code = code { codeName = Just n }

-- Distinguish overloads and constructor variants with the same display name.
-- Execution erases this operation; only inspection hashes the declaration.
namedFunction :: T.Text -> Func -> Code a -> Code a
namedFunction name declaration code = namedCode (name <> "#" <> fingerprint) code
  { sourceExpression = LetE [PragmaD (LineP 0 ("solidvm-parameters:" ++ show parameters))] (sourceExpression code) }
  where
    parameters = [maybe "" T.unpack parameter | (parameter, _) <- declaration ^. funcArgs]
    fingerprint = TE.decodeUtf8 $ B16.encode $ keccak256ToByteString $ hash $ TE.encodeUtf8 $ T.pack (show declaration)

functionName :: T.Text -> Name
functionName n = mkName $ "fn_" ++ concatMap (\c -> if isAscii c && isAlphaNum c then [c] else "_" ++ showHex (ord c) "" ++ "_") (T.unpack n)

instance ToSource Fun where
  toSource (Fun n sig body) = app 'Core.Fun [toSource n,toSource sig,
    case codeName body of
      Just name -> VarE (functionName name)
      Nothing -> sourceExpression body]
instance (ToSource a, ToSource b) => ToSource (Either a b) where
  toSource (Left a) = app 'Left [toSource a]
  toSource (Right b) = app 'Right [toSource b]

builtinBinding :: Code a -> Code a
builtinBinding = id

haskellType :: Ty a -> Type
haskellType = \case
  TInt -> ConT ''Integer
  TDecimal -> ConT ''Decimal
  TBool -> ConT ''Bool
  TAddr -> ConT ''Address
  TContract _ -> ConT ''Address
  TStr -> ConT ''T.Text
  TBytes -> ConT ''B.ByteString
  TEnum _ _ -> ConT ''EnumValue
  TUnit -> TupleT 0
  TArr t -> AppT (ConT ''Data.Sequence.Seq) (haskellType t)
  TStruct _ fs -> AppT (ConT ''HL) (fieldTypes fs)
  TTuple fs -> AppT (ConT ''HL) (fieldTypes fs)
  TVariadic -> AppT ListT (ConT ''Dyn)
  TRaw -> AppT ListT (ConT ''Dyn)
  TWireArray -> AppT ListT (ConT ''Dyn)
  TWireEnum _ _ -> ConT ''Integer
  TAlias t _ -> AppT (AppT (ConT ''Either) (ConT ''StoragePath)) (haskellType t)
  TMaybe t -> AppT (ConT ''Maybe) (haskellType t)
  TRef _ -> ConT ''StoragePath
  where
    fieldTypes :: Fields ts -> Type
    fieldTypes FNil = PromotedNilT
    fieldTypes (FCons _ t rest) = AppT (AppT PromotedConsT (haskellType t)) (fieldTypes rest)

signatureType :: Sig args r -> Type
signatureType (SigNil r) = AppT (ConT ''SM) (haskellType r)
signatureType (SigCons t rest) = AppT (AppT ArrowT (haskellType t)) (signatureType rest)

functionDeclarations :: Fun -> [Dec]
functionDeclarations (Fun _ sig body) = case codeName body of
  Just name -> [SigD (functionName name) (signatureType sig), ValD (VarP (functionName name)) (NormalB (sourceExpression body)) []]
  Nothing -> error "compiled function has no inspection name"

environmentType :: [EnvTy] -> Type
environmentType types = AppT (ConT ''Env) (foldr (\slot rest -> AppT (AppT PromotedConsT (slotType slot)) rest) PromotedNilT types)
  where
    slotType (RefSlot t) = AppT (ConT ''IORef) (haskellType t)
    slotType (ValueSlot t) = haskellType t

arrow :: Type -> Type -> Type
arrow a b = AppT (AppT ArrowT a) b

monadType :: Type -> Type
monadType = AppT (ConT ''SM)

annotate :: Type -> Code a -> Code a
annotate t code = code { codeType = Just t, codeForm = form, sourceExpression = expression }
  where
    expression = case t of
      AppT (ConT monad) _ | monad == ''SM || monad == ''IO ->
        LetE [PragmaD (LineP 0 "solidvm-action")] residual
      _ -> residual
    residual = annotateFunctionExpression t form (sourceExpression code)
    form = annotateForm t (codeForm code)

annotateForm :: Type -> Form a -> Form a
annotateForm t form = case (t, form) of
  (AppT (AppT ArrowT _) result, ConstantFunction body) -> ConstantFunction (annotate result body)
  (AppT (AppT ArrowT argument) result, StaticFunction previous specialize) ->
    StaticFunction (annotateForm t previous) (annotate result . specialize . annotate argument)
  (AppT (AppT ArrowT argument) (AppT _ result), FunctionSequence steps (PureFunction function))
    | nestedMonad result -> FunctionSequence steps (PureFunction (annotate (arrow argument result) function))
  (AppT _ result, PureAction value) | nestedMonad result -> PureAction (annotate result value)
  _ -> form
  where
    nestedMonad (AppT (ConT monad) _) | monad == ''SM || monad == ''IO = True
    nestedMonad (AppT function argument) = nestedMonad function || nestedMonad argument
    nestedMonad _ = False

annotateFunctionExpression :: Type -> Form a -> Exp -> Exp
annotateFunctionExpression t (StaticFunction previous _) expression = annotateFunctionExpression t previous expression
annotateFunctionExpression t (FunctionSequence steps end) _ = actionFunctionExpression (Just t) (functionAction steps end)
annotateFunctionExpression t (ActionFunction action) _ = actionFunctionExpression (Just t) action
annotateFunctionExpression _ _ expression = expression

typedCode :: [EnvTy] -> Ty r -> Code (Env ls -> SM r) -> Code (Env ls -> SM r)
typedCode env r = annotate (arrow (environmentType env) (monadType (haskellType r)))

typedBody :: [EnvTy] -> Ty r -> Code (Env ls -> SM (Flow r)) -> Code (Env ls -> SM (Flow r))
typedBody env r = annotate (arrow (environmentType env) (monadType (AppT (ConT ''Flow) (haskellType r))))

typedUnary :: Ty a -> Ty b -> Code (a -> SM b) -> Code (a -> SM b)
typedUnary a b = annotate (arrow (haskellType a) (monadType (haskellType b)))

typedSetter :: [EnvTy] -> Ty a -> Code (Env ls -> a -> SM ()) -> Code (Env ls -> a -> SM ())
typedSetter env t = annotate (arrow (environmentType env) (arrow (haskellType t) (monadType (TupleT 0))))

typedPath :: [EnvTy] -> Code (Env ls -> SM (Maybe StoragePath)) -> Code (Env ls -> SM (Maybe StoragePath))
typedPath env = annotate (arrow (environmentType env) (monadType (AppT (ConT ''Maybe) (ConT ''StoragePath))))

typedDestination :: [EnvTy] -> Ty a -> Code (Env ls -> SM (Maybe StoragePath, SM a, a -> SM ())) -> Code (Env ls -> SM (Maybe StoragePath, SM a, a -> SM ()))
typedDestination env t = annotate (arrow (environmentType env) (monadType
  (AppT (AppT (AppT (TupleT 3) (AppT (ConT ''Maybe) (ConT ''StoragePath))) (monadType (haskellType t)))
    (arrow (haskellType t) (monadType (TupleT 0))))))

typedCall :: Sig args r -> Code (Fn args r -> HL args -> SM r) -> Code (Fn args r -> HL args -> SM r)
typedCall sig code = code { codeType = Just (arrow (signatureType sig)
  (arrow (AppT (ConT ''HL) (arguments sig)) (monadType (haskellType (sigRet sig))))) }
  where
    arguments :: Sig as result -> Type
    arguments (SigNil _) = PromotedNilT
    arguments (SigCons t rest) = AppT (AppT PromotedConsT (haskellType t)) (arguments rest)

typedGetter :: Sig args r -> Code (StoragePath -> Env (RefTypes args) -> SM r) -> Code (StoragePath -> Env (RefTypes args) -> SM r)
typedGetter sig = annotate (arrow (ConT ''StoragePath) (arrow (signatureEnvironment sig) (monadType (haskellType (sigRet sig)))))

signatureEnvironment :: Sig args r -> Type
signatureEnvironment = environmentType . types
  where
    types :: Sig args r -> [EnvTy]
    types (SigNil _) = []
    types (SigCons t rest) = RefSlot t : types rest

typedSnapshot :: Sig args r -> Code (Env (RefTypes args) -> SM [Dyn]) -> Code (Env (RefTypes args) -> SM [Dyn])
typedSnapshot sig = annotate (arrow (signatureEnvironment sig) (monadType (AppT ListT (ConT ''Dyn))))

typedDestructure :: [EnvTy] -> Fields ts -> Ty r -> Code (Env ls -> HL ts -> SM (Flow r)) -> Code (Env ls -> HL ts -> SM (Flow r))
typedDestructure env fs r = annotate (arrow (environmentType env)
  (arrow (haskellType (TTuple fs)) (monadType (AppT (ConT ''Flow) (haskellType r)))))

typedTupleSetters :: [EnvTy] -> Fields ts -> Code (Env ls -> SM (HL ts -> SM ())) -> Code (Env ls -> SM (HL ts -> SM ()))
typedTupleSetters env fs = annotate (arrow (environmentType env)
  (monadType (arrow (haskellType (TTuple fs)) (monadType (TupleT 0)))))

emitFunction :: [FunctionStep env] -> FunctionEnd env a -> Code (env -> SM a)
emitFunction [] (ResidualFunction code) = code
emitFunction steps end = Code (inspectionOnly undefined) (actionFunctionExpression Nothing (functionAction steps end)) Nothing Nothing (FunctionSequence steps end)

actionFunctionExpression :: Maybe Type -> Code (Action env m a) -> Exp
actionFunctionExpression annotation action = AppE (VarE 'runAction) expression
  where
    expression = case annotation of
      Just (AppT (AppT ArrowT env) (AppT monad result)) ->
        SigE (toSource (actionProgram action)) (AppT (AppT (AppT (ConT ''Action) env) monad) result)
      _ -> toSource (actionProgram action)

hlistCode :: Code a -> Code (HL ls) -> Code (HL (a ': ls))
hlistCode a b = Code (runCode a :* runCode b) (app '(:*) [toSource a, toSource b]) Nothing Nothing (HListValue a b)

hlistConstructor :: Code (a -> HL ls -> HL (a ': ls))
hlistConstructor = Code (:*) (ConE '(:*)) Nothing Nothing Ordinary

writePrimitiveResidual :: Ty a -> Code (StoragePath -> a -> SM ())
writePrimitiveResidual ty = Code (inspectionOnly undefined)
  (AppE (VarE 'writeVal) (toSource ty)) Nothing Nothing Ordinary

writeFunctionResidual :: Ty a -> Code StoragePath -> Code (a -> SM ())
writeFunctionResidual ty code = Code (inspectionOnly undefined)
  (AppE (AppE (VarE 'writeVal) (toSource ty)) (toSource code)) Nothing Nothing Ordinary

replaceResidual :: Ix ls a -> Code a -> Code (Env ls) -> Code (Env ls)
replaceResidual index value code = Code (replaceValue index (runCode value) (runCode code))
  (AppE (AppE (AppE (VarE 'replaceValue) (toSource index)) (toSource value)) (toSource code)) Nothing Nothing Ordinary

primitiveCode :: Primitive a -> Code a
primitiveCode primitive = Code (inspectionOnly undefined) expression Nothing Nothing Ordinary
  where
    expression = case primitive of
      IdentityPrimitive -> VarE 'id
      ReturnPrimitive -> ConE 'Core.Ret
      DynamicReturnPrimitive -> ConE 'Core.RetDynamic
      NotPrimitive -> VarE 'not
      EqualPrimitive -> VarE '(==)
      LessPrimitive -> VarE '(<)
      GreaterPrimitive -> VarE '(>)
      LessEqualPrimitive -> VarE '(<=)
      GreaterEqualPrimitive -> VarE '(>=)
      HNilPrimitive -> ConE 'HNil
      NextPrimitive -> ConE 'Next
      BreakPrimitive -> ConE 'Brk
      ContinuePrimitive -> ConE 'Cnt
      EmptyListPrimitive -> ListE []
      FromIntegerPrimitive -> VarE 'fromInteger
      FromListPrimitive -> VarE 'Data.Sequence.fromList
      DynPrimitive ty -> AppE (ConE 'Dyn) (toSource ty)
      RetDynPrimitive ty -> AppE (VarE 'retDyn) (toSource ty)
      ApplyLastPrimitive -> VarE 'applyLast

mapComputation :: Code (a -> b) -> Code (Action env SM a) -> Code (Action env SM b)
mapComputation function action = Code (inspectionOnly undefined)
  (AppE (AppE (VarE 'fmap) (toSource function)) (toSource action)) Nothing Nothing Ordinary

applyComputation :: Code (Action env SM (a -> b)) -> Code (Action env SM a) -> Code (Action env SM b)
applyComputation function action = Code (inspectionOnly undefined)
  (InfixE (Just (toSource function)) (VarE '(<*>)) (Just (toSource action))) Nothing Nothing Ordinary

traverseFunctionResidual :: [Code (env -> SM a)] -> Code (env -> SM [a])
traverseFunctionResidual functions = Code (inspectionOnly undefined)
  (LamE [VarP environment] (AppE (AppE (VarE 'mapM)
    (InfixE Nothing (VarE '($)) (Just (VarE environment)))) (ListE (map toSource functions))))
  Nothing Nothing Ordinary
  where environment = mkName "environment"

extendValueResidual :: Code (Env (a ': ls) -> b) -> Code (Env ls -> a -> b)
extendValueResidual function = Code (inspectionOnly undefined)
  (LamE [VarP environment] (LamE [VarP value]
    (AppE (toSource function) (app '(:&) [VarE value, VarE environment])))) Nothing Nothing Ordinary
  where environment = mkName "environment"; value = mkName "value"

dropEnvironmentResidual :: Code (Env ls -> b) -> Code (Env (a ': ls) -> b)
dropEnvironmentResidual function = Code (inspectionOnly undefined)
  (LamE [ConP '(:&) [] [WildP, VarP environment]]
    (AppE (toSource function) (VarE environment))) Nothing Nothing Ordinary
  where environment = mkName "environment"

bindEnvironmentResidual :: Code (Env ls -> SM a) -> Code (Env (a ': ls) -> SM b) -> Code (Env ls -> SM b)
bindEnvironmentResidual initial next = Code (inspectionOnly undefined)
  (LamE [VarP environment] (DoE Nothing
    [BindS (VarP value) (AppE (toSource initial) (VarE environment)),
     NoBindS (AppE (toSource next) (app '(:&) [VarE value, VarE environment]))])) Nothing Nothing Ordinary
  where environment = mkName "environment"; value = mkName "value"

functionBindResidual :: Code (env -> SM a) -> Code (env -> a -> SM b) -> Code (env -> SM b)
functionBindResidual first next = Code (inspectionOnly undefined)
  (LamE [VarP environment] (InfixE (Just (AppE (toSource first) (VarE environment)))
    (VarE '(>>=)) (Just (AppE (toSource next) (VarE environment))))) Nothing Nothing Ordinary
  where environment = mkName "environment"

extendValueAt :: Code (Env ls) -> Code (Env (a ': ls) -> b) -> Code (a -> b)
extendValueAt environment function = Code (inspectionOnly undefined)
  (LamE [VarP value] (AppE (toSource function) (app '(:&) [VarE value, toSource environment])))
  Nothing Nothing Ordinary
  where value = mkName "value"

emitGasResult :: Integer -> Code a -> Code (SM a)
emitGasResult gas = emitResultSteps [GasStep gas]

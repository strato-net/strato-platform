{-# LANGUAGE GADTs, CPP, ExistentialQuantification, DataKinds, TypeOperators #-}
-- Compiler facts are discarded when the final executable action is extracted.
module SolidVM.Code where

import SolidVM.Core (M, Action, runAction, contextAction, liftAction, chargeAction, storeAction, Ty, HL(..), Env(..), Ix(..), localValue, chargeGas, chargeAfter, writeVal, replaceValue)
import qualified SolidVM.Core as Core
import Data.IORef (IORef)
import Data.Decimal (Decimal)
import qualified Data.Sequence
import qualified Data.Text as T
import Control.Monad (void)
import SolidVM.Model.Storable (StoragePath)

data Code a = Code a (Form a)

#include "ActionCode.inc"

codeForm :: Code a -> Form a
codeForm (Code _ form) = form

runCode :: Code a -> a
runCode (Code value _) = value

-- Pattern-match outside the executable closure, so it captures the executable
-- value, rather than a thunk that retains compiler metadata.
withCode :: Code a -> (a -> b) -> b
withCode (Code value _) continuation = continuation value

withCode2 :: Code a -> Code b -> (a -> b -> result) -> result
withCode2 (Code a _) (Code b _) continuation = continuation a b

withCode3 :: Code a -> Code b -> Code c -> (a -> b -> c -> result) -> result
withCode3 (Code a _) (Code b _) (Code c _) continuation = continuation a b c

withCode4 :: Code a -> Code b -> Code c -> Code d -> (a -> b -> c -> d -> result) -> result
withCode4 (Code a _) (Code b _) (Code c _) (Code d _) continuation = continuation a b c d

withCodes :: [Code a] -> ([a] -> b) -> b
withCodes [] continuation = continuation []
withCodes (code : codes) continuation = withCode code $ \value ->
  withCodes codes $ \values -> continuation (value : values)

plainCode :: a -> Code a
plainCode value = Code value Ordinary

constantFunction :: Code b -> Code (a -> b)
constantFunction code = withCode code $ \value -> Code (const value) (ConstantFunction code)

pureAction :: Applicative m => Code a -> Code (m a)
pureAction code = withCode code $ \value -> Code (pure value) (PureAction code)

withForm :: Form a -> Code a -> Code a
withForm form code = withCode code $ \value -> Code value form

actionFunction :: Monad m => Code (Action env m a) -> Code (env -> m a)
actionFunction code = withCode code $ \action -> action `seq` Code (runAction action) (ActionFunction code)

actionResidual :: Code (env -> m a) -> Code (Action env m a)
actionResidual code = withCode code $ \function -> function `seq` plainCode (contextAction function)

actionLiftResidual :: Code (m a) -> Code (Action env m a)
actionLiftResidual code = withCode code $ \action -> action `seq` Code (liftAction action) (LiftedComputation code)

actionProgram :: Code (Action env m a) -> Code (Action env m a)
actionProgram = id
{-# INLINE actionProgram #-}

actionReturn :: Monad m => Code a -> Code (Action env m a)
actionReturn code = withCode code $ \value -> Code (pure value) (PureComputation code)

actionCharge :: Integer -> Code (Action env M ())
actionCharge = plainCode . chargeAction

actionStore :: Ty a -> Code StoragePath -> Code a -> Code (Action env M ())
actionStore ty path value = withCode path $ \p -> withCode value $ \v -> plainCode (storeAction ty p v)

referenceAction :: Ix ls (IORef a) -> Code (Action (Env ls) M a)
referenceAction = plainCode . Core.readReference

valueAction :: Ix ls a -> Code (Action (Env ls) M a)
valueAction = plainCode . Core.valueAt

actionAfter :: Integer -> Code (Action env M a) -> Code (Action env M a)
actionAfter gas code = withCode code $ \action -> action `seq` plainCode (Core.chargeActionAfter gas action)

actionThenResidual :: Code (Action env M a) -> Code (Action env M b) -> Code (Action env M b)
actionThenResidual first second = withCode first $ \a -> withCode second $ \b -> a `seq` b `seq` plainCode (a >> b)

actionPureResidual :: Code (env -> a) -> Code (Action env M a)
actionPureResidual code = withCode code $ \f -> f `seq` plainCode (fmap f Core.askEnvironment)

actionWritePath :: Ty a -> Code StoragePath -> Code (env -> a) -> Code (Action env M ())
actionWritePath ty path value = withCode path $ \p -> withCode value $ \v ->
  v `seq` plainCode (contextAction (\env -> writeVal ty p (v env)))

actionWriteValue :: Ty a -> Code (env -> StoragePath) -> Code a -> Code (Action env M ())
actionWriteValue ty path value = withCode path $ \p -> withCode value $ \v ->
  p `seq` plainCode (contextAction (\env -> writeVal ty (p env) v))

actionWriteResidual :: Ty a -> Code (env -> StoragePath) -> Code (env -> a) -> Code (Action env M ())
actionWriteResidual ty path value = withCode path $ \p -> withCode value $ \v ->
  p `seq` v `seq` plainCode (contextAction (\env -> writeVal ty (p env) (v env)))

applyResidual :: Code (a -> b) -> Code a -> Code b
applyResidual function argument = withCode function $ \f -> withCode argument $ \value -> plainCode (f value)

bindResidual :: Code (M a) -> Code (a -> M b) -> Code (M b)
bindResidual first continuation = withCode first $ \action -> withCode continuation $ \next -> plainCode (action >>= next)

mapResidual :: Code (a -> b) -> Code (M a) -> Code (M b)
mapResidual function action = withCode function $ \f -> withCode action $ \a -> plainCode (fmap f a)

applyActionResidual :: Code (M (a -> b)) -> Code (M a) -> Code (M b)
applyActionResidual function action = withCode function $ \f -> withCode action $ \a -> plainCode (f <*> a)

integerCode :: Integer -> Code Integer
integerCode value = Code value (IntegerValue value)

listCode :: [Code a] -> Code [a]
listCode codes = withCodes codes plainCode

sequenceResidual :: [Code (M a)] -> Code (M [a])
sequenceResidual codes = withCodes codes (plainCode . sequence)

unitCode :: Code ()
unitCode = Code () UnitValue

emitUnitSteps :: [ActionStep] -> Code (M ())
emitUnitSteps steps = let action = lowerUnitSteps steps in action `seq` plainCode action

emitResultSteps :: [ActionStep] -> Code a -> Code (M a)
emitResultSteps steps value = withCode value $ \result ->
  let action = lowerSteps steps (pure result)
   in action `seq` plainCode action

emitResidualSteps :: [ActionStep] -> Code (M a) -> Code (M a)
emitResidualSteps steps final = withCode final $ \tailAction ->
  let action = lowerSteps steps tailAction
   in action `seq` plainCode action

lowerSteps :: [ActionStep] -> M a -> M a
lowerSteps [] final = final
lowerSteps (step : steps) final =
  let rest = lowerSteps steps final
   in rest `seq` case step of
        GasStep gas -> chargeGas gas >> rest
        EffectStep code -> withCode code $ \action -> action >> rest
        WriteStep ty path value -> withCode path $ \p -> withCode value $ \v -> writeVal ty p v >> rest

lowerUnitSteps :: [ActionStep] -> M ()
lowerUnitSteps [] = pure ()
lowerUnitSteps [GasStep gas] = chargeGas gas
lowerUnitSteps [EffectStep code] = withCode code void
lowerUnitSteps [WriteStep ty path value] = withCode path $ \p -> withCode value $ \v -> writeVal ty p v
lowerUnitSteps [GasStep gas, WriteStep ty path value] = withCode path $ \p -> withCode value $ \v ->
  do chargeGas gas; writeVal ty p v
lowerUnitSteps (step : steps) =
  let rest = lowerUnitSteps steps
   in rest `seq` case step of
        GasStep gas -> chargeGas gas >> rest
        EffectStep code -> withCode code $ \action -> action >> rest
        WriteStep ty path value -> withCode path $ \p -> withCode value $ \v -> writeVal ty p v >> rest

emptyEnvironment :: Code (Env '[])
emptyEnvironment = Code ENil EmptyEnvironment

valueEnvironment :: Code a -> Code (Env ls) -> Code (Env (a ': ls))
valueEnvironment value rest = withCode value $ \v -> withCode rest $ \env ->
  Code (v :& env) (ValueEnvironment value rest)

localResidual :: Ix ls a -> Code (Env ls) -> Code a
localResidual index code = withCode code $ \env -> plainCode (localValue index env)

afterResidual :: Integer -> Code (M a) -> Code (M a)
afterResidual gas code = withCode code $ \action -> plainCode (chargeAfter gas action)

optionalCode :: Maybe (Code a) -> Code (Maybe a)
optionalCode Nothing = plainCode Nothing
optionalCode (Just code) = withCode code (plainCode . Just)

emitFunction :: [FunctionStep env] -> FunctionEnd env a -> Code (env -> M a)
emitFunction [] (ResidualFunction code) = code
emitFunction steps end =
  withCode (functionAction steps end) $ \action ->
    let function = runAction action
     in function `seq` Code function (FunctionSequence steps end)

hlistCode :: Code a -> Code (HL ls) -> Code (HL (a ': ls))
hlistCode a b = withCode a $ \x -> withCode b $ \y -> Code (x :* y) (HListValue a b)

hlistConstructor :: Code (a -> HL ls -> HL (a ': ls))
hlistConstructor = plainCode (:*)

writePrimitiveResidual :: Ty a -> Code (StoragePath -> a -> M ())
writePrimitiveResidual = plainCode . writeVal

writeFunctionResidual :: Ty a -> Code StoragePath -> Code (a -> M ())
writeFunctionResidual ty code = withCode code $ \path -> plainCode (writeVal ty path)

replaceResidual :: Ix ls a -> Code a -> Code (Env ls) -> Code (Env ls)
replaceResidual index value code = withCode value $ \v -> withCode code $ \env -> plainCode (replaceValue index v env)

bindChainResidual :: T.Text -> Code (M a) -> [Code (a -> M a)] -> Code (a -> M b) -> Code (M b)
bindChainResidual _ initial commands final = withCode initial $ \start -> withCodes commands $ \steps ->
  withCode final $ \finish -> plainCode (Core.bindActionChain start steps finish)

primitiveCode :: Primitive a -> Code a
primitiveCode primitive = plainCode $ case primitive of
  IdentityPrimitive -> id
  ReturnPrimitive -> Core.Ret
  DynamicReturnPrimitive -> Core.RetDynamic
  NotPrimitive -> not
  EqualPrimitive -> (==)
  LessPrimitive -> (<)
  GreaterPrimitive -> (>)
  LessEqualPrimitive -> (<=)
  GreaterEqualPrimitive -> (>=)
  HNilPrimitive -> HNil
  NextPrimitive -> Core.Next
  BreakPrimitive -> Core.Brk
  ContinuePrimitive -> Core.Cnt
  EmptyListPrimitive -> []
  FromIntegerPrimitive -> fromInteger
  FromListPrimitive -> Data.Sequence.fromList
  DynPrimitive ty -> Core.Dyn ty
  RetDynPrimitive ty -> Core.retDyn ty
  ApplyLastPrimitive -> Core.applyLast

mapComputation :: Code (a -> b) -> Code (Action env M a) -> Code (Action env M b)
mapComputation function action = withCode function $ \f -> withCode action $ \a ->
  a `seq` plainCode (fmap f a)

applyComputation :: Code (Action env M (a -> b)) -> Code (Action env M a) -> Code (Action env M b)
applyComputation function action = withCode function $ \f -> withCode action $ \a ->
  f `seq` a `seq` plainCode (f <*> a)

traverseFunctionResidual :: [Code (env -> M a)] -> Code (env -> M [a])
traverseFunctionResidual functions = withCodes functions $ \actions ->
  plainCode (\environment -> mapM ($ environment) actions)

extendValueResidual :: Code (Env (a ': ls) -> b) -> Code (Env ls -> a -> b)
extendValueResidual function = withCode function $ \f ->
  plainCode (\environment value -> f (value :& environment))

dropEnvironmentResidual :: Code (Env ls -> b) -> Code (Env (a ': ls) -> b)
dropEnvironmentResidual function = withCode function $ \f ->
  plainCode (\(_ :& environment) -> f environment)

bindEnvironmentResidual :: Code (Env ls -> M a) -> Code (Env (a ': ls) -> M b) -> Code (Env ls -> M b)
bindEnvironmentResidual initial next = withCode initial $ \start -> withCode next $ \finish ->
  plainCode (\environment -> do value <- start environment; finish (value :& environment))

functionBindResidual :: Code (env -> M a) -> Code (env -> a -> M b) -> Code (env -> M b)
functionBindResidual first next = withCode first $ \start -> withCode next $ \finish ->
  plainCode (\environment -> start environment >>= finish environment)

extendValueAt :: Code (Env ls) -> Code (Env (a ': ls) -> b) -> Code (a -> b)
extendValueAt environment function = withCode environment $ \env -> withCode function $ \f ->
  plainCode (\value -> f (value :& env))

emitGasResult :: Integer -> Code a -> Code (M a)
emitGasResult gas value = withCode value $ \result ->
  let action = do chargeGas gas; pure result
   in action `seq` plainCode action

{-# INLINE codeForm #-}
{-# INLINE runCode #-}
{-# INLINE withCode #-}
{-# INLINE withCode2 #-}
{-# INLINE withCode3 #-}
{-# INLINE withCode4 #-}
{-# INLINE withCodes #-}
{-# INLINE plainCode #-}
{-# INLINE constantFunction #-}
{-# INLINE pureAction #-}
{-# INLINE withForm #-}
{-# INLINE actionFunction #-}
{-# INLINE actionResidual #-}
{-# INLINE actionLiftResidual #-}
{-# INLINE actionReturn #-}
{-# INLINE actionCharge #-}
{-# INLINE actionStore #-}
{-# INLINE referenceAction #-}
{-# INLINE valueAction #-}
{-# INLINE actionAfter #-}
{-# INLINE actionThenResidual #-}
{-# INLINE actionPureResidual #-}
{-# INLINE actionWritePath #-}
{-# INLINE actionWriteValue #-}
{-# INLINE actionWriteResidual #-}
{-# INLINE applyResidual #-}
{-# INLINE bindResidual #-}
{-# INLINE mapResidual #-}
{-# INLINE applyActionResidual #-}
{-# INLINE integerCode #-}
{-# INLINE listCode #-}
{-# INLINE sequenceResidual #-}
{-# INLINE unitCode #-}
{-# INLINE emitUnitSteps #-}
{-# INLINE emitResultSteps #-}
{-# INLINE emitResidualSteps #-}
{-# INLINE lowerSteps #-}
{-# INLINE lowerUnitSteps #-}
{-# INLINE emptyEnvironment #-}
{-# INLINE valueEnvironment #-}
{-# INLINE localResidual #-}
{-# INLINE afterResidual #-}
{-# INLINE optionalCode #-}
{-# INLINE emitFunction #-}
{-# INLINE hlistCode #-}
{-# INLINE hlistConstructor #-}
{-# INLINE writePrimitiveResidual #-}
{-# INLINE writeFunctionResidual #-}
{-# INLINE replaceResidual #-}
{-# INLINE bindChainResidual #-}
{-# INLINE primitiveCode #-}
{-# INLINE mapComputation #-}
{-# INLINE applyComputation #-}
{-# INLINE traverseFunctionResidual #-}
{-# INLINE extendValueResidual #-}
{-# INLINE dropEnvironmentResidual #-}
{-# INLINE bindEnvironmentResidual #-}
{-# INLINE functionBindResidual #-}
{-# INLINE extendValueAt #-}
{-# INLINE emitGasResult #-}

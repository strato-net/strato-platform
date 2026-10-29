{-# LANGUAGE DataKinds, GADTs, KindSignatures, TypeOperators, RankNTypes, ScopedTypeVariables,
             LambdaCase, OverloadedStrings, ExistentialQuantification, TupleSections, NamedFieldPuns, CPP, TypeApplications #-}
-- SolidVM source -> typed Haskell actions.  Typecheck and compile in one pass over the
-- existing parser's CodeCollection.  Strict: no implicit coercions; anything the typed
-- model cannot express is reported as an Err, never approximated.
-- Contract-to-address is a selected compatibility exception (see README.md).
module SolidVM.Compile where

import Blockchain.SolidVM.SM (SM)
import Control.Exception (throwIO)
import Control.Lens ((^.), (&), (.~))
import Control.Monad
import Control.Monad.Reader
import Data.Bifunctor (first)
import Data.Decimal
import Data.Bits
import qualified Data.ByteString as B
import qualified Data.ByteString.Base16 as B16
import qualified Data.ByteString.Char8 as BC
import Data.IORef
import qualified Data.Map.Strict as M
import Data.Maybe
import qualified Data.Sequence as Seq
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import Data.Type.Equality ((:~:) (Refl))
import Blockchain.Strato.Model.Address (Address (..))
import qualified Data.Source.Annotation as SA
import qualified Data.Source.Position as SP
import SolidVM.Model.CodeCollection hiding (DelegateCall, RawCall, Internal)
import qualified SolidVM.Model.CodeCollection.Statement as S
import SolidVM.Model.Storable (BasicValue (BDefault), StoragePath (..), StoragePathPiece (..))
import qualified SolidVM.Model.Type as Ty
import {-# SOURCE #-} qualified SolidVM.Runtime as Runtime
import SolidVM.Core
import SolidVM.Code
import qualified SolidVM.Builtins as Builtins
import qualified Blockchain.SolidVM.Builtins.Operations.Metered as Operations
import qualified Blockchain.SolidVM.Builtins.Size as SharedSize
import qualified Blockchain.SolidVM.Builtins.Casts.Metered as MeteredCasts
import qualified Blockchain.SolidVM.Builtins.Functions.Metered as Metered
import qualified Blockchain.SolidVM.Builtins.Operators.Metered as Operators

makeFun :: T.Text -> Sig args r -> Code (Fn args r) -> Fun
makeFun name sig action = withCode action (Fun name sig)

linkedAction :: a -> a
linkedAction = id
{-# INLINE linkedAction #-}

constantCode :: Ty a -> a -> Code (b -> SM a)
constantCode _ v = constantFunction (pureAction (plainCode v))
{-# INLINE constantCode #-}
valueCode :: Ty a -> a -> Code a
valueCode _ value = plainCode value
{-# INLINE valueCode #-}
namedCode :: T.Text -> a -> a
namedCode _ a = a
{-# INLINE namedCode #-}
namedFunction :: T.Text -> Func -> a -> a
namedFunction _ _ a = a
{-# INLINE namedFunction #-}
builtinBinding :: Code a -> Code a
builtinBinding code = withCode code $ \function -> function `seq` code
{-# INLINE builtinBinding #-}

typedCode :: [EnvTy] -> Ty r -> a -> a
typedCode _ _ a = a
{-# INLINE typedCode #-}
typedBody :: [EnvTy] -> Ty r -> a -> a
typedBody _ _ a = a
{-# INLINE typedBody #-}
typedUnary :: Ty a -> Ty b -> Code (a -> SM b) -> Code (a -> SM b)
typedUnary _ _ = id
{-# INLINE typedUnary #-}
typedSetter :: [EnvTy] -> Ty r -> a -> a
typedSetter _ _ a = a
{-# INLINE typedSetter #-}
typedPath :: [EnvTy] -> a -> a
typedPath _ a = a
{-# INLINE typedPath #-}
typedDestination :: [EnvTy] -> Ty r -> a -> a
typedDestination _ _ a = a
{-# INLINE typedDestination #-}
typedCall :: Sig args r -> a -> a
typedCall _ a = a

typedGetter :: Sig args r -> a -> a
typedGetter _ a = a
{-# INLINE typedGetter #-}
typedSnapshot :: Sig args r -> a -> a
typedSnapshot _ a = a
{-# INLINE typedSnapshot #-}

typedDestructure :: [EnvTy] -> Fields ts -> Ty r -> a -> a
typedDestructure _ _ _ a = a
{-# INLINE typedDestructure #-}
typedTupleSetters :: [EnvTy] -> Fields ts -> a -> a
typedTupleSetters _ _ a = a
{-# INLINE typedTupleSetters #-}

#define EMIT_BEGIN plainCode (
#define EMIT_END )
#define CAPTURE withCode
#define CAPTURE2 withCode2
#define CAPTURE3 withCode3
#define CAPTURE4 withCode4
#define CAPTURES withCodes
#include "Compiler.inc"

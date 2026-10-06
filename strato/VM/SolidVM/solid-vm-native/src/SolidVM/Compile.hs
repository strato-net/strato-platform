{-# LANGUAGE DataKinds, GADTs, KindSignatures, TypeOperators, RankNTypes, ScopedTypeVariables,
             LambdaCase, OverloadedStrings, ExistentialQuantification, TupleSections, NamedFieldPuns, CPP, TemplateHaskell, TypeApplications #-}
-- SolidVM source -> typed Haskell actions.  Typecheck and compile in one pass over the
-- existing parser's CodeCollection.  Strict: no implicit coercions; anything the typed
-- model cannot express is reported as an Err, never approximated.
-- Contract-to-address is a selected compatibility exception (see README.md).
module SolidVM.Compile where

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
import Blockchain.Strato.Model.Keccak256 (hash, keccak256ToByteString)
import qualified Data.Source.Annotation as SA
import qualified Data.Source.Position as SP
import SolidVM.Model.CodeCollection hiding (DelegateCall, RawCall, Internal)
import qualified SolidVM.Model.CodeCollection.Statement as S
import SolidVM.Model.Storable (BasicValue (BDefault), StoragePath (..), StoragePathPiece (..))
import qualified SolidVM.Model.Type as Ty
import SolidVM.Core
import qualified SolidVM.Quotation.Execution as Quotation
import qualified SolidVM.Builtins as Builtins

type Code a = a
runCode :: a -> a
runCode = id
{-# INLINE runCode #-}

bindCodeChain :: T.Text -> Code (M a) -> [Code (a -> M a)] -> Code (a -> M b) -> Code (M b)
bindCodeChain _ = bindActionChain
{-# INLINE bindCodeChain #-}

constantCode :: Ty a -> a -> Code (b -> M a)
constantCode _ v = \_ -> pure v
{-# INLINE constantCode #-}
namedCode :: T.Text -> a -> a
namedCode _ a = a
{-# INLINE namedCode #-}
namedFunction :: T.Text -> Func -> a -> a
namedFunction _ _ a = a
{-# INLINE namedFunction #-}
builtinCode :: T.Text -> a -> a
builtinCode _ a = a
{-# INLINE builtinCode #-}

typedCode :: [EnvTy] -> Ty r -> a -> a
typedCode _ _ a = a
{-# INLINE typedCode #-}
typedBody :: [EnvTy] -> Ty r -> a -> a
typedBody _ _ a = a
{-# INLINE typedBody #-}
typedSetter :: [EnvTy] -> Ty r -> a -> a
typedSetter _ _ a = a
{-# INLINE typedSetter #-}
typedPath :: [EnvTy] -> a -> a
typedPath _ a = a
{-# INLINE typedPath #-}
typedDestination :: [EnvTy] -> Ty r -> a -> a
typedDestination _ _ a = a
{-# INLINE typedDestination #-}
typedGetter :: Sig args r -> a -> a
typedGetter _ a = a
{-# INLINE typedGetter #-}

typedDestructure :: [EnvTy] -> Fields ts -> Ty r -> a -> a
typedDestructure _ _ _ a = a
{-# INLINE typedDestructure #-}
typedTupleSetters :: [EnvTy] -> Fields ts -> a -> a
typedTupleSetters _ _ a = a
{-# INLINE typedTupleSetters #-}

#include "Compiler.inc"

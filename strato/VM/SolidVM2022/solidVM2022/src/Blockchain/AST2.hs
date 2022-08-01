{-# LANGUAGE ExistentialQuantification #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeSynonymInstances #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE QuantifiedConstraints #-}
{-# LANGUAGE IncoherentInstances #-}
{-# LANGUAGE UndecidableInstances #-}

module Blockchain.AST2 where

import Control.Monad
import Data.IORef

data Variable = forall a.(Show a, SolidType Expression a) => Variable (IORef a)

data Value = forall a.Show a=> Value a

instance Show Value where
  show (Value x) = show x

instance Show Variable where
  show _ = "<unnamed variable>"

data Statement = 
  Assign Expression Expression
  | ExpressionStatement Expression deriving (Show)

data Function a = Function a [Expression]

data AnyFunction = forall a . (SolidType (Function a) Integer, SolidType (Function a) String, SolidType (Function a) Value, SolidType (Function a) ()) => AnyFunction (Function a)

instance Show (Function a) where
  show _ = "<function>"

data PartiallyAppliedFunction a = PartiallyAppliedFunction a [Expression]

instance NamedType a => SolidType (Function (IO a)) a where
  getGetter (Function f []) = return f
  getGetter _ = Left "too many parameters"
  
instance (NamedType a, Show a) => SolidType (Function (IO a)) Value where
  getGetter (Function f []) = return $ fmap Value f
  getGetter _ = error $ "poppy: " ++ typename (undefined :: a)
  
instance (NamedType a, NamedType b) => SolidType (Function (IO a)) b where
  getGetter (Function _ []) = Left $ "type mismatch: function returns: " ++ show (typename (undefined :: a)) ++ ", expected: " ++ show (typename (undefined ::b))
  getGetter _ = Left "too many parameters"
  
instance (NamedType c, SolidType Expression a, SolidType (PartiallyAppliedFunction (IO b)) (IO c)) =>
         SolidType (Function (a->b)) c  where
  getGetter (Function f (first:rest)) = do
    firstGetter <- getGetter first
    
    fmap join $ getGetter $ PartiallyAppliedFunction (f <$> firstGetter) rest
  getGetter (Function _ []) = Left "Not enough parameters"

instance (SolidType (PartiallyAppliedFunction (IO b)) c, SolidType Expression a) =>
         SolidType (PartiallyAppliedFunction (IO (a->b))) c where
    getGetter (PartiallyAppliedFunction f (first:rest)) = do
      firstGetter <- getGetter first
      getGetter $ PartiallyAppliedFunction (f <*> firstGetter) rest
    getGetter _ = error "not enough arguments"

instance SolidType (PartiallyAppliedFunction (IO (IO a))) (IO a) where
  getGetter (PartiallyAppliedFunction f []) = return f
  getGetter _ = error "too many arguments"

instance Show a => SolidType (PartiallyAppliedFunction (IO (IO a))) (IO Value) where
  getGetter (PartiallyAppliedFunction f []) = return $ fmap (fmap Value) f
  getGetter _ = error "too many arguments"

instance SolidType (PartiallyAppliedFunction (IO (IO a))) (IO b) where
  getGetter (PartiallyAppliedFunction _ []) = Left "can't convert type"
  getGetter _ = error "too many arguments"



instance Show Expression where
  show (EInteger i) = show i
  show (EString s) = show s
  show (EVariable _) = "<some variable>"
  show (EFunction _) = "<some function>"

data Expression =
  EInteger Integer
  | EString String
  | EVariable Variable
  | EFunction AnyFunction

class NamedType a where
  typename :: a -> String

instance NamedType String where
  typename _ = "String"

instance NamedType AnyFunction where
  typename _ = "AnyFunction"

instance NamedType Value where
  typename _ = "Value"

instance NamedType Integer where
  typename _ = "Integer"

instance NamedType Address where
  typename _ = "Address"

instance NamedType Expression where
  typename _ = "Expression"

instance NamedType (PartiallyAppliedFunction a) where
  typename _ = "PartiallyAppliedFunction"

instance NamedType (IO a) where
  typename _ = "IO a"

instance NamedType () where
  typename _ = "()"

instance NamedType (Function a) where
  typename _ = "Function"


class (NamedType a, NamedType b) => SolidType a b where
  getGetter :: a -> Either String (IO b)

instance SolidType Expression Integer where
  getGetter (EInteger v) = Right $ return v
  getGetter (EFunction func) = getGetter func
  getGetter _ = Left "type mismatch: can't convert to Integer"

instance SolidType Expression Value where
  getGetter (EString v) = Right $ return $ Value v
  getGetter (EInteger v) = Right $ return $ Value v
  getGetter (EVariable (Variable v)) = return $ fmap Value $ readIORef v
  getGetter (EFunction f) = getGetter f
  
instance SolidType Expression String where
  getGetter (EString v) = Right $ return v
  getGetter (EFunction func) = getGetter func
  getGetter _ = Left "type mismatch: can't convert to String"

instance SolidType Expression Address where
  getGetter (EInteger v) = Right $ return $ Address $ fromInteger v
  getGetter _ = Left "type mismatch: can't convert to Address"

instance SolidType AnyFunction Integer where
  getGetter (AnyFunction f)= getGetter f

instance SolidType AnyFunction String where
  getGetter (AnyFunction f)= getGetter f

instance SolidType AnyFunction Value where
  getGetter (AnyFunction f)= getGetter f

instance SolidType AnyFunction () where
  getGetter (AnyFunction f)= getGetter f

newtype Address = Address Int deriving (Show)

assign :: Expression -> Expression -> Either String (IO ())
assign (EVariable (Variable ioRef)) rExp = do
  getter <- getGetter rExp
  return $ do
    value <- getter
    writeIORef ioRef value
assign _ _ = Left "You can't assign a value to a non variable"

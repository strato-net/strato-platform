-- move lobrary
{-# LANGUAGE DataKinds             #-}
{-# LANGUAGE FlexibleInstances     #-}
{-# LANGUAGE KindSignatures        #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE ScopedTypeVariables   #-}
{-# LANGUAGE TypeFamilies          #-}
{-# LANGUAGE TypeOperators         #-}

module Tags where

import           Control.Lens
import           Data.HashSet.InsOrd
import           Data.Swagger
import           Data.Text
import           Data.Typeable       (Typeable)
import           GHC.TypeLits        (KnownSymbol, Symbol, symbolVal)
import           Servant             hiding (Context)
import           Servant.Mock
import           Servant.Swagger

data Tags (sym :: Symbol)
    deriving (Typeable)

instance HasServer api ctx => HasServer (Tags tags :> api) ctx where
  type ServerT (Tags tags :> api) m = ServerT api m
  route _ = route (Proxy :: Proxy api)
  hoistServerWithContext _ = hoistServerWithContext (Proxy :: Proxy api)

instance (KnownSymbol tags, HasSwagger api) => HasSwagger (Tags tags :> api) where
  toSwagger _ = toSwagger (Proxy :: Proxy api)
    & allOperations.tags %~ union (fromList [pack (symbolVal (Proxy :: Proxy tags))])

-- instance HasMock api context => HasMock (Tags t :> api) context where
--     mock _ = mock (Proxy :: Proxy api)
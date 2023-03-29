{-# LANGUAGE Strict #-}

module BlockApps.Bloc22.Database.Tables where

import Data.Profunctor.Product
import Opaleye
import Opaleye.Internal.PGTypesExternal
import Opaleye.Internal.Table

contractsSourceTable :: Table
  ( Maybe (Field PGInt4)
  , Field PGBytea
  , Field PGText
  )
  ( Field PGInt4
  , Field PGBytea
  , Field PGText
  )
contractsSourceTable = Table "contracts_source" $ p3
  ( optionalTableField "id"
  , requiredTableField "src_hash"
  , requiredTableField "src"
  )

evmContractNameTable :: Table
  ( Maybe (Field PGInt4)
  , Field PGBytea
  , Field PGText
  , Field PGBytea
  )
  ( Field PGInt4
  , Field PGBytea
  , Field PGText
  , Field PGBytea
  )
evmContractNameTable = Table "evm_contract_name" $ p4
  ( optionalTableField "id"
  , requiredTableField "code_hash"
  , requiredTableField "contract_name"
  , requiredTableField "src_hash"
  )

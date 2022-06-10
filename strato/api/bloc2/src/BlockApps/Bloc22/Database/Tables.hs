module BlockApps.Bloc22.Database.Tables where

import Data.Profunctor.Product
import Opaleye

contractsSourceTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGBytea
  , Column PGText
  )
  ( Column PGInt4
  , Column PGBytea
  , Column PGText
  )
contractsSourceTable = Table "contracts_source" $ p3
  ( optional "id"
  , required "src_hash"
  , required "src"
  )

evmContractNameTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGBytea
  , Column PGText
  , Column PGBytea
  )
  ( Column PGInt4
  , Column PGBytea
  , Column PGText
  , Column PGBytea
  )
evmContractNameTable = Table "evm_contract_name" $ p4
  ( optional "id"
  , required "code_hash"
  , required "contract_name"
  , required "src_hash"
  )
module BlockApps.Bloc22.Database.Tables (
  contractsInstanceTable,
  contractsSourceTable,
  contractsMetaDataTable,
  contractsTable
  ) where

import Data.Profunctor.Product
import Opaleye

contractsTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGText
  )
  ( Column PGInt4
  , Column PGText
  )
contractsTable = Table "contracts" $ p2
  ( optional "id"
  , required "name"
  )

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

contractsMetaDataTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGInt4
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  )
  ( Column PGInt4
  , Column PGInt4
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  )
contractsMetaDataTable = Table "contracts_metadata" $ p8
  ( optional "id"
  , required "contract_id"
  , required "bin"
  , required "bin_runtime"
  , required "code_hash"
  , required "xcode_hash"
  , required "src_hash"
  , required "xabi"
  )

contractsInstanceTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGInt4
  , Column PGBytea
  , Maybe (Column PGTimestamptz)
  , Column PGBytea
  )
  ( Column PGInt4
  , Column PGInt4
  , Column PGBytea
  , Column PGTimestamptz
  , Column PGBytea
  )
contractsInstanceTable = Table "contracts_instance" $ p5
  ( optional "id"
  , required "contract_metadata_id"
  , required "address"
  , optional "timestamp"
  , required "chainid"
  )


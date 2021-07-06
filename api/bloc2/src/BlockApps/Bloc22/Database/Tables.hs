module BlockApps.Bloc22.Database.Tables where

import Data.Profunctor.Product
import Opaleye

usersTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGText
  )
  ( Column PGInt4
  , Column PGText
  )
usersTable = Table "users" $ p2
  ( optional "id"
  , required "name"
  )

keyStoreTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGInt4
  )
  ( Column PGInt4
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGBytea
  , Column PGInt4
  )
keyStoreTable = Table "keystore" $ p8
  ( optional "id"
  , required "salt"
  , required "password_hash"
  , required "nonce"
  , required "enc_sec_key"
  , required "pub_key"
  , required "address"
  , required "user_id"
  )

hashNameTable :: Table
  ( Maybe (Column PGInt4)
  , Column PGBytea
  , Column PGInt4
  , Column PGInt4
  , Column PGText
  )
  ( Column PGInt4
  , Column PGBytea
  , Column PGInt4
  , Column PGInt4
  , Column PGText
  )
hashNameTable = Table "hash_name" $ p5
  ( optional "id"
  , required "hash"
  , required "contract_metadata_id"
  , required "transaction_type"
  , required "data_string"
  )

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
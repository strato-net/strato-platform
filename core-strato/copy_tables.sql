ALTER TABLE IF EXISTS storage RENAME TO storage_backup;
CREATE TABLE storage AS storage_backup WITH NO DATA;

ALTER TABLE IF EXISTS address_state_ref RENAME TO address_state_ref_backup;
CREATE TABLE address_state_ref AS address_state_ref_backup WITH NO DATA;

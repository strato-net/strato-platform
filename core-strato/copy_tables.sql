ALTER TABLE storage RENAME TO storage_backup;
CREATE TABLE storage AS storage_backup WITH NO DATA;

ALTER TABLE address_state_ref RENAME TO address_state_ref_backup;
CREATE TABLE address_state_ref AS address_state_ref_backup WITH NO DATA;

UPDATE p_peer SET active_state = 0;

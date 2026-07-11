ALTER TABLE raw.record
  ADD CONSTRAINT record_source_key_length_chk
  CHECK (octet_length(source_record_key) <= 512)
  NOT VALID;

ALTER TABLE raw.record
  VALIDATE CONSTRAINT record_source_key_length_chk;

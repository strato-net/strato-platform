CREATE TEMP TABLE benchmark_hash (
  table_name text,
  row_count bigint,
  row_hash text
);

DO $benchmark$
DECLARE
  table_record record;
  row_expression text;
BEGIN
  FOR table_record IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  LOOP
    -- event.id is a non-key serial whose assignment order changes with a
    -- multi-row INSERT. The event primary key and every business field remain
    -- part of the comparison.
    row_expression := CASE table_record.tablename
      WHEN 'event' THEN '(to_jsonb(row_data) - ''id'')'
      ELSE 'to_jsonb(row_data)'
    END;

    EXECUTE format(
      'INSERT INTO benchmark_hash
       SELECT %L,
              count(*),
              md5(COALESCE(string_agg(md5((%s)::text), ''''
                  ORDER BY md5((%s)::text)), ''''))
       FROM %I.%I AS row_data',
      table_record.tablename,
      row_expression,
      row_expression,
      table_record.schemaname,
      table_record.tablename
    );
  END LOOP;
END
$benchmark$;

SELECT table_name || '|' || row_count || '|' || row_hash
FROM benchmark_hash
ORDER BY table_name;

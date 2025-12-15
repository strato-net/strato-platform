-- Transaction Metrics Schema
-- Run this to create the table and indexes

create table if not exists tx_metrics (
  id bigserial primary key,
  ts timestamptz not null default now(),
  tx_hash text not null,
  submit_time_ms bigint not null,
  confirm_time_ms bigint not null,
  duration_ms integer not null,
  status text not null,
  asset_count integer not null default 0
);

create index if not exists tx_metrics_ts_idx on tx_metrics (ts desc);
create index if not exists tx_metrics_hash_idx on tx_metrics (tx_hash);

-- Example query: Get recent transactions
-- select * from tx_metrics order by ts desc limit 10;

-- Example query: Get average duration by status
-- select status, avg(duration_ms) as avg_duration_ms, count(*) 
-- from tx_metrics 
-- group by status;

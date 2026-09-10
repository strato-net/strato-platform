#!/usr/bin/env bash

set -euo pipefail

die() {
  echo "slipstream-pg-batching: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

is_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

median() {
  sort -n "$1" | awk '
    { values[NR] = $1 }
    END {
      if (NR == 0) exit 1
      if (NR % 2 == 1) print values[(NR + 1) / 2]
      else print (values[NR / 2] + values[NR / 2 + 1]) / 2
    }
  '
}

for command_name in initdb pg_ctl createdb psql pgbench postgres awk sort mktemp; do
  require_command "$command_name"
done

benchmark_rows="${ROWS:-2718}"
benchmark_runs="${RUNS:-3}"
benchmark_seconds="${SECONDS_PER_RUN:-2}"
benchmark_port="${PORT:-55449}"
keep_temporary="${KEEP_TMP:-0}"

is_positive_integer "$benchmark_rows" || die "ROWS must be a positive integer"
is_positive_integer "$benchmark_runs" || die "RUNS must be a positive integer"
is_positive_integer "$benchmark_seconds" || die "SECONDS_PER_RUN must be a positive integer"
is_positive_integer "$benchmark_port" || die "PORT must be a positive integer"
[[ "$benchmark_port" -le 65535 ]] || die "PORT must be at most 65535"
[[ "$keep_temporary" == "0" || "$keep_temporary" == "1" ]] ||
  die "KEEP_TMP must be 0 or 1"

benchmark_dir="$(mktemp -d /tmp/slipstream-pg-batching.XXXXXX)"
database_dir="$benchmark_dir/postgres"
postgres_log="$benchmark_dir/postgres.log"
single_script="$benchmark_dir/single-row.sql"
batch_script="$benchmark_dir/batch.sql"
single_rates="$benchmark_dir/single-rates.txt"
batch_rates="$benchmark_dir/batch-rates.txt"
server_started=0

cleanup() {
  if [[ "$server_started" == "1" ]]; then
    pg_ctl -D "$database_dir" -m fast -w stop >/dev/null 2>&1 || true
  fi

  if [[ "$keep_temporary" == "1" ]]; then
    echo "temporary_artifacts=$benchmark_dir"
    return
  fi

  case "$benchmark_dir" in
    /tmp/slipstream-pg-batching.*|/private/tmp/slipstream-pg-batching.*)
      rm -rf -- "$benchmark_dir"
      ;;
    *)
      echo "refusing to remove unexpected temporary path: $benchmark_dir" >&2
      ;;
  esac
}
trap cleanup EXIT

initdb -D "$database_dir" --no-locale --encoding=UTF8 --auth=trust >/dev/null
pg_ctl \
  -D "$database_dir" \
  -l "$postgres_log" \
  -o "-k $benchmark_dir -h '' -p $benchmark_port" \
  -w start >/dev/null
server_started=1

createdb -h "$benchmark_dir" -p "$benchmark_port" slipstream_bench
psql \
  -X \
  -h "$benchmark_dir" \
  -p "$benchmark_port" \
  -d slipstream_bench \
  -v ON_ERROR_STOP=1 \
  -c "
    CREATE TABLE event (
      address text NOT NULL,
      block_hash text NOT NULL,
      event_index integer NOT NULL,
      payload jsonb NOT NULL,
      PRIMARY KEY (address, block_hash, event_index)
    );
    INSERT INTO event
    SELECT
      lpad(i::text, 40, '0'),
      md5(i::text),
      i,
      jsonb_build_object('i', i)
    FROM generate_series(1, $benchmark_rows) AS generated(i);
  " >/dev/null

cat >"$single_script" <<'SQL'
\set id random(1, :benchmark_rows)
INSERT INTO event (address, block_hash, event_index, payload)
VALUES (
  lpad((:id)::text, 40, '0'),
  md5((:id)::text),
  :id,
  jsonb_build_object('i', :id)
)
ON CONFLICT DO NOTHING;
SQL

psql \
  -X \
  -h "$benchmark_dir" \
  -p "$benchmark_port" \
  -d slipstream_bench \
  -A \
  -t \
  -o "$batch_script" \
  -v ON_ERROR_STOP=1 \
  -c "
    SELECT
      'INSERT INTO event (address, block_hash, event_index, payload) VALUES '
      || string_agg(
        format(
          '(%L,%L,%s,%L::jsonb)',
          lpad(i::text, 40, '0'),
          md5(i::text),
          i,
          jsonb_build_object('i', i)::text
        ),
        ','
      )
      || ' ON CONFLICT DO NOTHING;'
    FROM generate_series(1, $benchmark_rows) AS generated(i);
  "

run_trial() {
  local run_number="$1"
  local mode="$2"
  local script_path
  local row_multiplier
  local output
  local latency_ms
  local transactions_per_second
  local rows_per_second
  local rate_file

  case "$mode" in
    single)
      script_path="$single_script"
      row_multiplier=1
      rate_file="$single_rates"
      ;;
    batch)
      script_path="$batch_script"
      row_multiplier="$benchmark_rows"
      rate_file="$batch_rates"
      ;;
    *)
      die "unknown trial mode: $mode"
      ;;
  esac

  output="$(
    pgbench \
      -n \
      -M simple \
      -h "$benchmark_dir" \
      -p "$benchmark_port" \
      -c 1 \
      -j 1 \
      -T "$benchmark_seconds" \
      -D "benchmark_rows=$benchmark_rows" \
      -f "$script_path" \
      slipstream_bench
  )"

  latency_ms="$(awk '/^latency average =/ { print $4; exit }' <<<"$output")"
  transactions_per_second="$(awk '/^tps =/ { print $3; exit }' <<<"$output")"
  [[ -n "$latency_ms" && -n "$transactions_per_second" ]] ||
    die "could not parse pgbench output for run $run_number mode $mode"

  rows_per_second="$(
    awk \
      -v transactions="$transactions_per_second" \
      -v multiplier="$row_multiplier" \
      'BEGIN { printf "%.6f", transactions * multiplier }'
  )"
  printf '%s\n' "$rows_per_second" >>"$rate_file"
  printf '%d\t%s\t%d\t%s\t%s\t%s\n' \
    "$run_number" \
    "$mode" \
    "$row_multiplier" \
    "$latency_ms" \
    "$transactions_per_second" \
    "$rows_per_second"
}

echo "benchmark=slipstream-pg-batching"
echo "postgres=$(postgres --version)"
echo "rows_per_batch=$benchmark_rows"
echo "runs_per_mode=$benchmark_runs"
echo "seconds_per_run=$benchmark_seconds"
echo "semantics=duplicate inserts with ON CONFLICT DO NOTHING"
printf 'run\tmode\trows_per_transaction\tlatency_ms\ttransactions_per_second\trow_attempts_per_second\n'

pgbench \
  -n \
  -M simple \
  -h "$benchmark_dir" \
  -p "$benchmark_port" \
  -c 1 \
  -j 1 \
  -t "$benchmark_rows" \
  -D "benchmark_rows=$benchmark_rows" \
  -f "$single_script" \
  slipstream_bench >/dev/null
pgbench \
  -n \
  -M simple \
  -h "$benchmark_dir" \
  -p "$benchmark_port" \
  -c 1 \
  -j 1 \
  -t 1 \
  -f "$batch_script" \
  slipstream_bench >/dev/null

for ((run_number = 1; run_number <= benchmark_runs; run_number += 1)); do
  if ((run_number % 2 == 1)); then
    run_trial "$run_number" single
    run_trial "$run_number" batch
  else
    run_trial "$run_number" batch
    run_trial "$run_number" single
  fi
done

median_single="$(median "$single_rates")"
median_batch="$(median "$batch_rates")"
speedup="$(
  awk \
    -v single="$median_single" \
    -v batch="$median_batch" \
    'BEGIN { printf "%.2f", batch / single }'
)"

echo "median_single_row_attempts_per_second=$median_single"
echo "median_batch_row_attempts_per_second=$median_batch"
echo "median_speedup=${speedup}x"

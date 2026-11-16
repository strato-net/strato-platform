#!/usr/bin/env bash
set -euo pipefail

CONVOKE=$(command -v "${1:-convoke}")
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT
mkdir -p "$TEST_DIR/bin"

cat > "$TEST_DIR/bin/docker" <<'EOF'
#!/bin/bash
set -euo pipefail
echo "$*" >> docker-calls
case "$*" in
    'compose -p strato up -d --wait')
        if [[ "$DOWN_EXIT" == missing ]]; then
            /bin/rm -- "$0"
        fi
        exit "$UP_EXIT"
        ;;
    'compose -p strato down') exit "$DOWN_EXIT" ;;
    *) exit 99 ;;
esac
EOF

cat > "$TEST_DIR/bin/fixture-child" <<'EOF'
#!/bin/bash
/usr/bin/touch child-launched
EOF
chmod +x "$TEST_DIR/bin/"*

run_case() {
    local name=$1 up_exit=$2 down_exit=$3 expected_exit=$4
    mkdir "$TEST_DIR/$name"
    (
        cd "$TEST_DIR/$name"
        echo fixture-child > commands.txt
        local actual_exit=0
        PATH="$TEST_DIR/bin" UP_EXIT="$up_exit" DOWN_EXIT="$down_exit" \
            "$CONVOKE" +RTS -N1 -RTS > output.log 2>&1 || actual_exit=$?
        [[ "$actual_exit" == "$expected_exit" ]]
        [[ $(head -1 docker-calls) == 'compose -p strato up -d --wait' ]]
        if [[ "$down_exit" == missing ]]; then
            grep -q 'ERROR: Docker cleanup failed:' output.log
            [[ $(wc -l < docker-calls) == 1 ]]
        else
            [[ $(tail -1 docker-calls) == 'compose -p strato down' ]]
            [[ $(wc -l < docker-calls) == 2 ]]
            if [[ "$down_exit" == 0 ]]; then
                grep -q 'Docker containers stopped.' output.log
            else
                grep -q "ERROR: docker compose down failed with exit code $down_exit" output.log
                ! grep -q 'Docker containers stopped.' output.log
            fi
        fi
        if [[ "$up_exit" == 0 ]]; then
            [[ -f child-launched ]]
        else
            [[ ! -f child-launched ]]
        fi
    )
    echo "PASS: $name"
}

run_case health-check-failure 1 0 1
run_case image-pull-failure 18 0 18
run_case cleanup-failure 18 7 18
run_case normal-shutdown 0 0 0
run_case cleanup-exception 18 missing 18

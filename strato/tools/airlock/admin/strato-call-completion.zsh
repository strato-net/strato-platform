#compdef strato-call
# Zsh completion for strato-call
# Copy to your $fpath or source directly

_strato_call() {
    local state
    local -a options contracts functions
    
    options=(
        '--help:Show help'
        '--list-functions:List functions for a contract'
        '--function-info:Show function parameters'
        '--register:Register a contract alias'
        '--unregister:Remove a contract alias'
        '--list-contracts:List registered contracts'
    )
    
    _arguments -C \
        '1: :->first' \
        '2: :->second' \
        '3: :->third' \
        '*: :->args' && return 0
    
    case $state in
        first)
            # First argument: options or contract aliases
            contracts=(${(f)"$(strato-call --complete-contracts 2>/dev/null)"})
            _describe 'command' options
            _describe 'contract' contracts
            ;;
        second)
            case "${words[2]}" in
                --list-functions|--unregister)
                    contracts=(${(f)"$(strato-call --complete-contracts 2>/dev/null)"})
                    _describe 'contract' contracts
                    ;;
                --function-info)
                    contracts=(${(f)"$(strato-call --complete-contracts 2>/dev/null)"})
                    _describe 'contract' contracts
                    ;;
                --register)
                    _message 'alias name'
                    ;;
                --*)
                    ;;
                *)
                    # After contract, show functions
                    functions=(${(f)"$(strato-call --complete-functions "${words[2]}" 2>/dev/null)"})
                    _describe 'function' functions
                    ;;
            esac
            ;;
        third)
            case "${words[2]}" in
                --function-info)
                    functions=(${(f)"$(strato-call --complete-functions "${words[3]}" 2>/dev/null)"})
                    _describe 'function' functions
                    ;;
                --register)
                    _message 'contract address (40 hex chars)'
                    ;;
            esac
            ;;
        args)
            # After function name, show parameters
            if [[ ! "${words[2]}" == --* ]]; then
                local contract="${words[2]}"
                local func="${words[3]}"
                local -a params used
                params=(${(f)"$(strato-call --function-info "$contract" "$func" 2>/dev/null | awk -F: '{gsub(/^[ \t]+/, \"\", $1); print $1 \"=\"}')"})
                # Filter out already-used params
                for ((i=4; i<$CURRENT; i++)); do
                    used+=(${words[i]%%=*})
                done
                for p in $params; do
                    local pname="${p%%=*}"
                    if (( ! ${+used[(r)$pname]} )); then
                        _describe 'parameter' "($p)"
                    fi
                done
            fi
            ;;
    esac
}

_strato_call "$@"

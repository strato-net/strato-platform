# Bash completion for strato-call
# Source this file: source strato-call-completion.bash
# Or copy to /etc/bash_completion.d/

_strato_call_completions() {
    local cur prev words cword
    _init_completion 2>/dev/null || {
        COMPREPLY=()
        cur="${COMP_WORDS[COMP_CWORD]}"
        prev="${COMP_WORDS[COMP_CWORD-1]}"
        cword=$COMP_CWORD
    }

    # Get the command being completed (handles ./strato-call, full path, or just strato-call)
    local cmd="${COMP_WORDS[0]}"
    
    local options="--help --list-functions --function-info --register --unregister --list-contracts"
    
    # First argument: options or contract aliases
    if [ $cword -eq 1 ]; then
        local contracts=$("$cmd" --complete-contracts 2>/dev/null)
        COMPREPLY=($(compgen -W "$options $contracts" -- "$cur"))
        return
    fi
    
    # After --list-functions, --function-info, --unregister: expect contract alias
    if [ "$prev" = "--list-functions" ] || [ "$prev" = "--unregister" ]; then
        local contracts=$("$cmd" --complete-contracts 2>/dev/null)
        COMPREPLY=($(compgen -W "$contracts" -- "$cur"))
        return
    fi
    
    # After --function-info with contract: expect function name
    if [ $cword -eq 3 ] && [ "${COMP_WORDS[1]}" = "--function-info" ]; then
        local contract="${COMP_WORDS[2]}"
        local functions=$("$cmd" --complete-functions "$contract" 2>/dev/null)
        COMPREPLY=($(compgen -W "$functions" -- "$cur"))
        return
    fi
    
    # Second argument after contract: function name
    if [ $cword -eq 2 ] && [[ ! "${COMP_WORDS[1]}" =~ ^-- ]]; then
        local contract="${COMP_WORDS[1]}"
        local functions=$("$cmd" --complete-functions "$contract" 2>/dev/null)
        COMPREPLY=($(compgen -W "$functions" -- "$cur"))
        return
    fi
    
    # After function name: show parameter hints (param=)
    if [ $cword -ge 3 ] && [[ ! "${COMP_WORDS[1]}" =~ ^-- ]]; then
        local contract="${COMP_WORDS[1]}"
        local func_name="${COMP_WORDS[2]}"
        # Get parameter names and format as "param="
        local params=$("$cmd" --function-info "$contract" "$func_name" 2>/dev/null | awk -F: '{gsub(/^[ \t]+/, "", $1); print $1 "="}')
        # Filter out already-used parameters
        local used_params=""
        for ((i=3; i<cword; i++)); do
            used_params="$used_params ${COMP_WORDS[i]%%=*}"
        done
        local available=""
        for p in $params; do
            local pname="${p%%=*}"
            if [[ ! " $used_params " =~ " $pname " ]]; then
                available="$available $p"
            fi
        done
        COMPREPLY=($(compgen -W "$available" -- "$cur"))
        return
    fi
}

# Register for both 'strato-call' and common path variations
complete -F _strato_call_completions strato-call
complete -F _strato_call_completions ./strato-call

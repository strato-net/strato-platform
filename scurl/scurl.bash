

_scurl() {

    commands="
    http://localhost/api/v2.0/cert
    http://localhost/api/v2.0/app
    http://localhost/api/v2.0/record
    http://localhost/api/v2.0/record/{record}/call/{function}
    http://localhost/api/v2.0/log
    http://localhost/api/v2.0/peers
    http://localhost/api/v2.0/uuid
    http://localhost/api/v2.0/version"

    
    local cur
    
    _get_comp_words_by_ref -n : cur
    
    COMPREPLY=( $(compgen -W "$commands" "$cur") )

    __ltrim_colon_completions "$cur"
}

complete -F _scurl scurl

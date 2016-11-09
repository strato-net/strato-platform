This docker image takes a single optional environment variable `ssl`, which can
be either `true` or `false` and controls whether nginx listens on port 443 for
SSL-secured connections, or on port 80 for open connections.  The default is
`false`.

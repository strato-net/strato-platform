-- owner is a fixed application role passed by pg-init.sh. Keep this scoped to
-- the current database's public schema: REASSIGN OWNED BY postgres would also
-- transfer the maintenance database and other shared objects.
BEGIN;
SELECT pg_advisory_xact_lock(617074, hashtext(current_database()));
-- Only objects whose ACL still grants PUBLIC are touched: GRANT and REVOKE
-- rewrite the catalog row even when nothing changes, and such a rewrite
-- meeting Slipstream's DDL on the primary fails one of the two.
SELECT 'REVOKE CREATE ON SCHEMA public FROM PUBLIC'
  FROM pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
 WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE'
\gexec
SELECT format('REVOKE ALL ON %s %s FROM PUBLIC', kind, string_agg(name, ', '))
  FROM (SELECT CASE WHEN c.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END AS kind,
               format('%I.%I', n.nspname, c.relname) AS name
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
           AND EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = 0)) rels
 GROUP BY kind
\gexec
SELECT 'REVOKE ALL ON ROUTINE ' || string_agg(format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), ', ') || ' FROM PUBLIC'
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)
HAVING count(*) > 0
\gexec

SELECT format('ALTER SCHEMA public OWNER TO %I', :'owner')
\gexec

SELECT format('ALTER %s %I.%I OWNER TO %I',
              CASE c.relkind WHEN 'S' THEN 'SEQUENCE'
                             WHEN 'v' THEN 'VIEW'
                             WHEN 'm' THEN 'MATERIALIZED VIEW'
                             WHEN 'f' THEN 'FOREIGN TABLE'
                             ELSE 'TABLE' END,
              n.nspname, c.relname, :'owner')
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
   AND pg_get_userbyid(c.relowner) = :'source_owner'
   AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
                      AND d.refclassid = 'pg_extension'::regclass AND d.deptype = 'e')
 ORDER BY CASE WHEN c.relkind = 'S' THEN 1 ELSE 0 END, c.oid
\gexec

SELECT format('ALTER %s %I.%I(%s) OWNER TO %I',
              CASE p.prokind WHEN 'p' THEN 'PROCEDURE'
                             WHEN 'a' THEN 'AGGREGATE'
                             ELSE 'FUNCTION' END,
              n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), :'owner')
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND pg_get_userbyid(p.proowner) = :'source_owner'
   AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
                      AND d.refclassid = 'pg_extension'::regclass AND d.deptype = 'e')
 ORDER BY p.oid
\gexec

SELECT format('ALTER %s %I.%I OWNER TO %I',
              CASE WHEN t.typtype = 'd' THEN 'DOMAIN' ELSE 'TYPE' END,
              n.nspname, t.typname, :'owner')
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  LEFT JOIN pg_class c ON c.oid = t.typrelid
 WHERE n.nspname = 'public'
   AND t.typtype IN ('e', 'd', 'c', 'r', 'm')
   AND (t.typrelid = 0 OR c.relkind = 'c')
   AND pg_get_userbyid(t.typowner) = :'source_owner'
   AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid
                      AND d.refclassid = 'pg_extension'::regclass AND d.deptype = 'e')
 ORDER BY t.oid
\gexec

SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', :'owner')
\gexec
COMMIT;

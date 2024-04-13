-- See https://www2.sqlite.org/cvstrac/wiki?p=InformationSchema
CREATE VIEW information_schema_tables AS
SELECT 'main'     AS table_catalog,
       'sqlite'   AS table_schema,
       tbl_name   AS table_name,
       CASE WHEN type = 'table' THEN 'BASE TABLE'
            WHEN type = 'view'  THEN 'VIEW'
       END        AS table_type,
       sql        AS table_source
FROM   sqlite_schema
WHERE  type IN ('table', 'view') AND tbl_name NOT LIKE 'INFORMATION_SCHEMA_%';

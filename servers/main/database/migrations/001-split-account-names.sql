-- Check that all existing names can be split before changing the accounts table.
CREATE TEMPORARY TABLE account_name_check (
    invalid_count BIGINT NOT NULL CHECK (invalid_count = 0)
);

INSERT INTO account_name_check (invalid_count)
SELECT COUNT(*)
FROM accounts
WHERE NOT REGEXP_LIKE(REGEXP_REPLACE(full_name, '^[[:space:]]+|[[:space:]]+$', ''),
                      '^[^[:space:]]+[[:space:]]+[^[:space:]]');

DROP TEMPORARY TABLE account_name_check;

ALTER TABLE accounts
    ADD COLUMN first_name VARCHAR(150) AFTER email,
    ADD COLUMN last_name VARCHAR(150) AFTER first_name;

UPDATE accounts
SET first_name = REGEXP_SUBSTR(full_name, '[^[:space:]]+'),
    last_name = REGEXP_REPLACE(full_name, '^[[:space:]]*[^[:space:]]+[[:space:]]+|[[:space:]]+$', '');

ALTER TABLE accounts
    MODIFY first_name VARCHAR(150) NOT NULL,
    MODIFY last_name VARCHAR(150) NOT NULL,
    ADD CONSTRAINT accounts_first_name_nonempty CHECK (TRIM(first_name) <> ''),
    ADD CONSTRAINT accounts_last_name_nonempty CHECK (TRIM(last_name) <> ''),
    DROP COLUMN full_name;

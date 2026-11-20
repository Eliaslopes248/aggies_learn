CREATE TABLE accounts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(254) NOT NULL CHECK (BINARY email = BINARY LOWER(TRIM(email)) AND email <> ''),
    first_name VARCHAR(150) NOT NULL CHECK (TRIM(first_name) <> ''),
    last_name VARCHAR(150) NOT NULL CHECK (TRIM(last_name) <> ''),
    password_hash TEXT,
    email_verified_at DATETIME(6),
    created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    UNIQUE (email)
) ENGINE=InnoDB;

CREATE TABLE account_roles (
    account_id BIGINT NOT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts (id),
    role VARCHAR(16) NOT NULL CHECK (role IN ('student', 'tutor', 'admin')),
    PRIMARY KEY (account_id, role)
) ENGINE=InnoDB;

-- Add development accounts with reserved example email addresses.
START TRANSACTION;

INSERT INTO accounts (email, first_name, last_name)
VALUES
    ('student1@example.test', 'Avery', 'Brooks'),
    ('student2@example.test', 'Jordan', 'Reed'),
    ('student3@example.test', 'Morgan', 'Ellis'),
    ('student4@example.test', 'Taylor', 'Hayes'),
    ('student5@example.test', 'Parker', 'Cole'),
    ('student6@example.test', 'Riley', 'Morgan'),
    ('tutor1@example.test', 'Cameron', 'Price'),
    ('tutor2@example.test', 'Casey', 'Bennett'),
    ('tutor3@example.test', 'Jamie', 'Ross'),
    ('admin1@example.test', 'Drew', 'Foster')
ON DUPLICATE KEY UPDATE id = accounts.id;

-- Use account emails to find the IDs assigned by MySQL.
INSERT INTO account_roles (account_id, role)
SELECT accounts.id, sample_roles.role
FROM accounts
JOIN (
    SELECT 'student1@example.test' AS email, 'student' AS role
    UNION ALL SELECT 'student2@example.test', 'student'
    UNION ALL SELECT 'student3@example.test', 'student'
    UNION ALL SELECT 'student4@example.test', 'student'
    UNION ALL SELECT 'student5@example.test', 'student'
    UNION ALL SELECT 'student6@example.test', 'student'
    UNION ALL SELECT 'tutor1@example.test', 'tutor'
    UNION ALL SELECT 'tutor2@example.test', 'tutor'
    UNION ALL SELECT 'tutor3@example.test', 'tutor'
    UNION ALL SELECT 'admin1@example.test', 'admin'
) AS sample_roles ON sample_roles.email = accounts.email
ON DUPLICATE KEY UPDATE role = account_roles.role;

COMMIT;

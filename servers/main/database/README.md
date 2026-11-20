# Aggies Learn MySQL schema

The SQL creates InnoDB tables in the database named by `MYSQL_DATABASE`. The subdirectories group tables by subsystem. The academic catalog is scoped to NC A&T and can hold multiple colleges and departments. Import the verified CS course catalog separately.

| Directory | Owns |
| --- | --- |
| `users/` | Accounts, email verification, and student, tutor, and admin roles |
| `academic/` | Colleges, departments, and courses |
| `tutoring/` | Admin-managed tutor course assignments |
| `appointments/` | Tutor availability and bookings |
| `notifications/` | Booking email outbox |

## Initialization

The Compose service mounts this directory at `/docker-entrypoint-initdb.d`. On first startup with an empty MySQL data volume, the image selects `MYSQL_DATABASE` and runs the top-level `00-bootstrap.sh`. Keep that file non-executable so the entrypoint sources it. The script uses the entrypoint’s SQL helper to load each raw SQL file in dependency order.

Use versioned migrations for existing volumes. MySQL DDL commits implicitly, so an interrupted initialization can leave a partial schema. Inspect the startup logs and schema before retrying or replacing a volume.

To inspect an initialized database from the repository root, run the following and enter the configured application password when prompted.

```sh
docker compose -f orchestrate/compose/main.compose.yaml exec mysql sh -c 'mysql -u "$MYSQL_USER" -p "$MYSQL_DATABASE"'
```

Then run `SHOW TABLES;`.

## Application transactions

- **Tutor provisioning** — Hiring happens through Handshake. An admin creates or reuses the hired tutor's account, grants the tutor role, and assigns courses. Verify the acting admin and save role and assignment changes in one transaction. Provide initial sign-in credentials securely to newly provisioned tutors. Store password hashes in MySQL.
- **Booking** — Use a single InnoDB transaction at `READ COMMITTED`. Lock both participant account rows using `SELECT … FOR UPDATE` in ascending ID order before checking for conflicts. Every booking writer must follow the same locking order, including rescheduling. Check both participants against both role columns on uncanceled bookings using `existing.starts_at < requested_end AND existing.ends_at > requested_start`. This allows adjacent bookings and prevents concurrent overlaps, including when an account books as a student and teaches as a tutor. The service enforces overlap protection through this transaction.
- **Availability and course access** — Lock the course assignment and availability block within the booking transaction. Check that the college, department, and course are active, the course assignment is current, and the block is open and contains the requested time. Lock the affected rows when editing availability or deactivating an assignment. Copy the location into the booking so later availability edits preserve the booked details.
- **Time and email** — Write scheduling times as UTC values into `DATETIME(6)` and convert for campus display in the application. Save the booking and tutor email job in the same transaction. Record cancellation and enqueue any cancellation email together. Retry unsuccessful deliveries from the outbox.

## Migrate an existing account table

Apply `migrations/001-split-account-names.sql` once to a database that still has
`accounts.full_name`, while the backend is stopped. The migration treats the
first word as the first name and the remaining words as the last name. Review
existing names before applying this split. The script stops before changing
the table if any account has a single-word name. Resolve those rows manually
before running the migration. Fresh volumes already use the split fields.

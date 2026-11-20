# Accounts, access, and student administration

## Account lifecycle

1. A student registers at `/register` with a first name, last name, email, and password. Registration grants the student role and signs the account in.
2. The student opens the emailed link and confirms it at `/verify-email`. The link is single use, expires after 30 minutes, and applies to the address it was sent to. The verification page can request another link.
3. At `/account`, users can update their name, email, and password. Changing either the email or password requires the current password. An email change clears verification and attempts to send a link to the new address. The user can request another link from the verification page if delivery fails.
4. Signing out ends the current refresh session. An account can have more than one role, which controls workspace navigation and server authorization.

Passwords are hashed with scrypt. The server issues a short-lived bearer token and rotates the refresh token stored in an HTTP-only cookie. The browser keeps the bearer token in memory and restores the session through the refresh endpoint. The API checks current database roles for privileged actions. Profiles omit credential fields and are cached in Redis for five minutes on profile reads.

## First local admin

The local database bootstrap seeds courses. Public registration creates students, so a developer with authorized access to the local MySQL database must grant the first admin role.

1. Register the intended admin account through the local app. Complete verification through [Mailpit](http://localhost:8025).
2. Open the local MySQL client with the configured application password.

   ```sh
   docker compose -f orchestrate/compose/main.compose.yaml exec mysql sh -c 'mysql -u "$MYSQL_USER" -p "$MYSQL_DATABASE"'
   ```

3. Replace the example address with the registered address, then grant and verify the role.

   ```sql
   INSERT INTO account_roles (account_id, role)
   SELECT id, 'admin' FROM accounts WHERE email = 'local.admin@example.test'
   ON DUPLICATE KEY UPDATE role = account_roles.role;

   SELECT a.email, r.role
   FROM accounts AS a
   JOIN account_roles AS r ON r.account_id = a.id
   WHERE a.email = 'local.admin@example.test';
   ```

4. Sign out and sign in again to load the role in the web app. The account retains its student role and gains access to **Admin**.

The optional [sample users SQL](../servers/main/database/users/sample-data/sample.users.sql) creates example profiles and roles for database testing. Those rows have no password hashes, so use registration to create sign-in accounts.

## Student administration

At **Admin → Students**, search by first name, last name, or both. The catalog shows email, verification status, and account creation date. Each row has an eye button for revealing the account ID and an Edit action for changing the student's name or password.

- **Set password** saves an admin-supplied password. The student can use it on their next sign-in.
- **Email a reset password** replaces the password with a generated value and sends it to the student's verified address. The student can then choose a new password in Account. When SMTP reports failure, the server attempts to restore the previous hash if the account still matches the reset operation.
- Password changes affect future password-based sign-ins. Existing sessions retain their normal expiration and logout behavior.

## API

These paths are relative to the Express server. Browser requests prepend `/api`.

| Method and path | Purpose |
| --- | --- |
| `POST /users` | Register a student and issue a session |
| `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` | Start, rotate, or end a session |
| `POST /auth/verify-email`, `POST /auth/resend-verification` | Consume a verification link or request a new one |
| `GET /users/me`, `PATCH /users/me` | Read or update the signed-in account |
| `GET /users/:accountId` | Look up an account and its roles as an admin |
| `GET /users/students`, `PATCH /users/students/:studentId` | Search the student directory or edit a student's name as an admin |
| `PUT /users/students/:studentId/password` | Set a student password as an admin |
| `POST /users/students/:studentId/password/reset` | Generate and email a student password as an admin |

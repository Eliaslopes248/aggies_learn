# Sourced by the MySQL image entrypoint. Its helper selects MYSQL_DATABASE.
for schema_file in \
    users/01-users.sql \
    academic/01-catalog.sql \
    tutoring/01-course-assignments.sql \
    appointments/01-scheduling.sql \
    notifications/01-email-outbox.sql
do
    printf 'Loading %s\n' "$schema_file"
    docker_process_sql < "/docker-entrypoint-initdb.d/$schema_file"
done
unset schema_file

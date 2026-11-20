# Sourced by the MySQL image entrypoint. Its helper selects MYSQL_DATABASE.
for sql_file in \
    users/01-users.sql \
    academic/01-catalog.sql \
    tutoring/01-course-assignments.sql \
    appointments/01-scheduling.sql \
    notifications/01-email-outbox.sql \
    academic/sample-data/sample.courses.sql
do
    printf 'Loading %s\n' "$sql_file"
    docker_process_sql < "/docker-entrypoint-initdb.d/$sql_file"
done
unset sql_file

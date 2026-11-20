# Course catalog and tutor assignments

## Course discovery

The catalog groups courses under departments and colleges. The Courses page supports search and filters, and a course page shows its details. Signed-in users can see the course's tutors and available times. The public catalog shows active colleges, departments, and courses.

## Admin catalog

At **Admin → Catalog**, create or edit colleges, departments, and courses, or archive entries that should disappear from discovery. Admins can include archived entries in management views. Archiving a parent also removes its descendants from public discovery.

The course importer accepts a JSON array of 1–100 records in a batch of up to 16 KiB. Use IDs from the active departments in your database. Preview the batch before importing it. The server writes the batch in one transaction.

```json
[
  {
    "departmentId": "1",
    "subjectCode": "COMP",
    "courseNumber": "101",
    "title": "Introduction to Computing"
  }
]
```

## Tutor provisioning and assignments

At **Admin → Tutors**, select **Provision tutor** to reuse an existing account ID or create a new tutor with an initial password. Pick the tutor's courses before saving. The tutor directory supports name search, an eye button for the account ID, and account metadata. The assignment editor lets admins update the tutor's name, add courses, and deactivate assignments.

Tutors see their active assignments under **Tutor → Assigned courses** at `/tutor/courses`. An active assignment makes that tutor eligible to offer sessions for the course. Deactivating an assignment stops new bookings through that assignment and preserves existing bookings.

## API

Browser requests prepend `/api` to these Express paths.

| Method and path | Purpose |
| --- | --- |
| `GET /catalog/colleges`, `GET /catalog/colleges/:collegeId/departments` | Read the catalog hierarchy |
| `GET /catalog/courses`, `GET /catalog/courses/:courseId` | Search courses or read course details |
| `POST /catalog/{colleges,departments,courses}` | Create a catalog entry as an admin |
| `PATCH` or `DELETE /catalog/{colleges,departments,courses}/:id` | Update or archive an entry as an admin |
| `POST /catalog/courses/import` | Import a reviewed course batch as an admin |
| `GET /tutors?courseId=…`, `GET /tutors/me/courses` | Read a course roster or the signed-in tutor's assignments |
| `GET /tutors/admin`, `POST /tutors`, `PATCH /tutors/:tutorId` | Browse tutors, provision one, or edit a tutor name as an admin |
| `GET /tutors/:tutorId/courses` | Review a tutor's assignments as an admin |
| `PUT` or `DELETE /tutors/:tutorId/courses/:courseId` | Add or deactivate an assignment as an admin |

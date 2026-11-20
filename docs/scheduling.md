# Availability, bookings, and email delivery

## Tutor calendar

At **Tutor → Calendar** (`/tutor/calendar`), tutors publish availability blocks by entering a start time, end time, and location. A location can be a room or a meeting URL. Tutors can edit or withdraw their own blocks. Edits must preserve booked time, and withdrawing availability removes open slots while preserving existing bookings.

The browser displays and collects time in Eastern time (`America/New_York`), including daylight-saving transitions. The API exchanges UTC timestamps, and MySQL stores them in UTC.

## Student booking

1. Sign in with a verified student account and open a course.
2. Select a day and a tutor slot. Sessions are 30 minutes long and must start at least 15 minutes in the future.
3. Review the tutor, course, and time, then confirm. The booking confirmation shows the time and location. Slot responses omit the location before booking.
4. Open **My Sessions** (`/sessions`) to review the booking or cancel an upcoming session.

A slot is only bookable while the tutor's course assignment and availability are active. The server rechecks eligibility and conflicts in a transaction. It locks participant accounts, checks overlapping uncanceled appointments for both people, and saves a copy of the location on the booking. Adjacent appointments are allowed. When a slot is taken between review and confirmation, the web app refreshes the slot list.

## Admin bookings and notifications

At **Admin → Bookings**, admins can filter sessions across participants, courses, dates, and cancellation status. Confirmed booking details are available to the participants and admins. Canceling a session preserves its record and marks it canceled.

Booking creation and cancellation write email jobs to the MySQL outbox in the same transaction as the booking change. Confirmations queue an email for the tutor. Cancellations queue a tutor notice and also notify the student when someone else canceled. The delivery worker uses SMTP and schedules failed jobs for retry. In the local stack, open [Mailpit](http://localhost:8025) to inspect messages.

## API

Browser requests prepend `/api` to these Express paths.

| Method and path | Purpose |
| --- | --- |
| `GET /availability/courses/:courseId/slots` | List bookable slots in a UTC window |
| `GET /availability/tutors/:tutorId/calendar` | Read a tutor calendar as its owner or an admin |
| `POST /availability/blocks` | Publish availability as the signed-in tutor |
| `PATCH` or `DELETE /availability/blocks/:blockId` | Edit or withdraw owned availability |
| `POST /bookings` | Confirm a slot as a verified student |
| `GET /bookings` | List the signed-in participant's sessions |
| `GET /bookings/admin` | Search bookings across participants as an admin |
| `GET` or `DELETE /bookings/:bookingId` | Read or cancel a session as a participant or admin |

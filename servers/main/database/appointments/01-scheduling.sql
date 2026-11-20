CREATE TABLE availability_blocks (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tutor_id BIGINT NOT NULL,
    FOREIGN KEY (tutor_id) REFERENCES accounts (id),
    starts_at DATETIME(6) NOT NULL,
    ends_at DATETIME(6) NOT NULL,
    location TEXT NOT NULL CHECK (TRIM(location) <> ''),
    withdrawn_at DATETIME(6),
    CHECK (starts_at < ends_at),
    UNIQUE (id, tutor_id)
) ENGINE=InnoDB;

CREATE INDEX availability_by_tutor_and_start
    ON availability_blocks (tutor_id, starts_at);

CREATE TABLE bookings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    availability_block_id BIGINT NOT NULL,
    course_id BIGINT NOT NULL,
    tutor_id BIGINT NOT NULL,
    student_id BIGINT NOT NULL,
    FOREIGN KEY (student_id) REFERENCES accounts (id),
    starts_at DATETIME(6) NOT NULL,
    ends_at DATETIME(6) NOT NULL,
    location TEXT NOT NULL CHECK (TRIM(location) <> ''),
    created_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    canceled_at DATETIME(6),
    canceled_by BIGINT,
    FOREIGN KEY (canceled_by) REFERENCES accounts (id),
    CHECK (starts_at < ends_at),
    CHECK (student_id <> tutor_id),
    CHECK ((canceled_at IS NULL) = (canceled_by IS NULL)),
    FOREIGN KEY (availability_block_id, tutor_id)
        REFERENCES availability_blocks (id, tutor_id),
    FOREIGN KEY (tutor_id, course_id)
        REFERENCES tutor_course_assignments (tutor_id, course_id)
) ENGINE=InnoDB;

CREATE INDEX bookings_by_tutor_and_start ON bookings (tutor_id, starts_at);
CREATE INDEX bookings_by_student_and_start ON bookings (student_id, starts_at);
CREATE INDEX bookings_by_course_and_start ON bookings (course_id, starts_at);

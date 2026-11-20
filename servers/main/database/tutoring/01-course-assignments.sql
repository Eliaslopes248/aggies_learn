CREATE TABLE tutor_course_assignments (
    tutor_id BIGINT NOT NULL,
    course_id BIGINT NOT NULL,
    assigned_by BIGINT NOT NULL,
    assigned_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    deactivated_at DATETIME(6),
    PRIMARY KEY (tutor_id, course_id),
    FOREIGN KEY (tutor_id) REFERENCES accounts (id),
    FOREIGN KEY (course_id) REFERENCES courses (id),
    FOREIGN KEY (assigned_by) REFERENCES accounts (id),
    INDEX tutor_assignments_by_course (course_id, deactivated_at)
) ENGINE=InnoDB;

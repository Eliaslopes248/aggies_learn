CREATE TABLE colleges (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL UNIQUE CHECK (TRIM(name) <> ''),
    archived_at DATETIME(6)
) ENGINE=InnoDB;

CREATE TABLE departments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    college_id BIGINT NOT NULL,
    FOREIGN KEY (college_id) REFERENCES colleges (id),
    name VARCHAR(150) NOT NULL CHECK (TRIM(name) <> ''),
    archived_at DATETIME(6),
    UNIQUE (college_id, name)
) ENGINE=InnoDB;

CREATE TABLE courses (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    department_id BIGINT NOT NULL,
    FOREIGN KEY (department_id) REFERENCES departments (id),
    subject_code VARCHAR(16) NOT NULL CHECK (BINARY subject_code = BINARY UPPER(TRIM(subject_code)) AND subject_code <> ''),
    course_number VARCHAR(16) NOT NULL CHECK (TRIM(course_number) <> ''),
    title VARCHAR(255) NOT NULL CHECK (TRIM(title) <> ''),
    archived_at DATETIME(6),
    UNIQUE (subject_code, course_number)
) ENGINE=InnoDB;

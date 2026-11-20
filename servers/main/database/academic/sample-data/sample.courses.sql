-- Add the college and department for the sample CS catalog.
START TRANSACTION;

INSERT INTO colleges (name)
VALUES ('College of Engineering')
ON DUPLICATE KEY UPDATE id = colleges.id;

INSERT INTO departments (college_id, name)
SELECT id, 'Computer Science'
FROM colleges
WHERE name = 'College of Engineering'
ON DUPLICATE KEY UPDATE id = departments.id;

-- Look up the department by name and preserve any existing courses.
INSERT INTO courses (department_id, subject_code, course_number, title)
SELECT departments.id, 'COMP', sample_courses.course_number, sample_courses.title
FROM departments
JOIN colleges ON colleges.id = departments.college_id
CROSS JOIN (
    SELECT '163' AS course_number, 'Introduction to Computer Programming' AS title
    UNION ALL SELECT '167', 'Computer Program Design'
    UNION ALL SELECT '180', 'Discrete Structures'
    UNION ALL SELECT '280', 'Data Structures'
    UNION ALL SELECT '285', 'Design and Analysis of Computer Algorithms'
    UNION ALL SELECT '322', 'Internet Systems'
    UNION ALL SELECT '350', 'Operating Systems'
    UNION ALL SELECT '410', 'Software Engineering'
) AS sample_courses
WHERE colleges.name = 'College of Engineering'
    AND departments.name = 'Computer Science'
ON DUPLICATE KEY UPDATE id = courses.id;

COMMIT;

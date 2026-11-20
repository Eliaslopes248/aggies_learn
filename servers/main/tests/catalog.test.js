import { expect, jest, test } from "@jest/globals";

import { CatalogService } from "../dist/services/catalog.service.js";

const course = { id: "3", departmentId: "2", subjectCode: "COMP", courseNumber: "101", title: "Intro" };

test("returns a course only while its full catalog hierarchy is active", async () =>
{
    const connection = {};
    // Simulate a course whose hierarchy becomes inactive between reads
    const catalog = {
        isCourseActive: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
        findCourse: jest.fn().mockResolvedValue(course),
    };
    const service = new CatalogService(catalog, {}, work => work(connection));

    await expect(service.getCourse(course.id)).resolves.toEqual(course);
    expect(catalog.findCourse).toHaveBeenCalledWith(course.id, connection);
    await expect(service.getCourse(course.id)).rejects.toMatchObject({ status: 404 });
    expect(catalog.findCourse).toHaveBeenCalledTimes(1);
});

test("requires an admin role before including archived courses", async () =>
{
    const catalog = { searchCourses: jest.fn().mockResolvedValue([course]) };
    const users = { listRoles: jest.fn().mockResolvedValueOnce(["student"]).mockResolvedValueOnce(["admin"]) };
    const service = new CatalogService(catalog, users, jest.fn());
    const filters = { limit: 10, offset: 0, includeArchived: true };

    await expect(service.searchCourses(filters, "1")).rejects.toMatchObject({ status: 403 });
    expect(catalog.searchCourses).not.toHaveBeenCalled();

    await expect(service.searchCourses(filters, "1")).resolves.toEqual([course]);
    expect(catalog.searchCourses).toHaveBeenCalledWith(filters);
});

test("validates a course import before writing normalized rows in one transaction", async () =>
{
    const connection = {};
    const catalog = {
        findDepartment: jest.fn().mockResolvedValue({ id: "2", collegeId: "1", archivedAt: null }),
        findCollege: jest.fn().mockResolvedValue({ id: "1", archivedAt: null }),
        createCourse: jest.fn().mockResolvedValue(course.id),
    };
    const users = { listRoles: jest.fn().mockResolvedValue(["admin"]) };
    const transaction = jest.fn(work => work(connection));
    const service = new CatalogService(catalog, users, transaction);
    const input = { departmentId: "2", subjectCode: " comp ", courseNumber: "101", title: " Intro " };

    // Check that duplicate input fails before a transaction opens
    await expect(service.importCourses("1", [input, input])).rejects.toMatchObject({
        status: 409, message: "Row 2: Duplicate course code COMP 101.",
    });
    expect(transaction).not.toHaveBeenCalled();

    await expect(service.importCourses("1", [input])).resolves.toEqual([course.id]);
    expect(catalog.createCourse).toHaveBeenCalledWith({
        departmentId: "2", subjectCode: "COMP", courseNumber: "101", title: "Intro",
    }, connection);
});

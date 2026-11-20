import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import { MySQLService } from "../../dist/database/mysql.service.js";
import { signAccessToken } from "../../dist/middleware/jwt.middleware.js";
import { ServiceError } from "../../dist/services/service.utils.js";
import { createServer } from "../../dist/settings/server.settings.js";

const profile = { id: "1", firstName: "Avery", lastName: "Reed", email: "student@example.test" };
const session = { accessToken: "test-access", refreshToken: "abc.def", refreshExpiresAt: Date.UTC(2035, 0, 1) };
const window = { startsAt: "2035-01-01T10:00:00Z", endsAt: "2035-01-01T11:00:00Z" };
let initialized;
let server;
let services;

beforeEach(async () =>
{
    // Mount the real routers while replacing database connections and service calls
    jest.replaceProperty(process, "env", {
        ...process.env, APP_MODE: "prod", DB_SVC_TYPE: "mysql", MYSQL_PASSWORD: "test-password",
        REDIS_URL: "", SMTP_URL: "", MAIL_FROM: "", JWT_SECRET: "a".repeat(64),
    });
    jest.spyOn(MySQLService.prototype, "connect").mockResolvedValue({});
    jest.spyOn(MySQLService.prototype, "disconnect").mockResolvedValue(undefined);

    initialized = await createServer();
    const { app } = initialized;
    services = {
        auth: {
            login: jest.fn().mockResolvedValue({ ...session, profile }),
            registerStudent: jest.fn().mockResolvedValue({ ...session, profile }),
            refresh: jest.fn().mockResolvedValue(session),
            logout: jest.fn().mockResolvedValue(undefined),
            verifyEmail: jest.fn().mockResolvedValue(undefined),
            sendVerification: jest.fn().mockResolvedValue(undefined),
        },
        users: {
            listRoles: jest.fn(async id => ({ "1": ["student"], "2": ["admin"], "3": ["tutor"] })[id] ?? []),
            getProfile: jest.fn(async id => ({ ...profile, id })),
        },
        catalog: {
            listColleges: jest.fn().mockResolvedValue([]),
            listDepartments: jest.fn().mockResolvedValue([]),
            searchCourses: jest.fn().mockResolvedValue([]),
            getCourse: jest.fn().mockResolvedValue({ id: "7" }),
            createEntry: jest.fn().mockResolvedValue("7"),
            updateEntry: jest.fn().mockResolvedValue(true),
            archiveEntry: jest.fn().mockResolvedValue(true),
            importCourses: jest.fn().mockResolvedValue(["7"]),
        },
        tutoring: {
            listTutorCourses: jest.fn().mockResolvedValue([]),
            listCourseTutors: jest.fn().mockResolvedValue([{ tutorId: "3" }]),
            provisionTutor: jest.fn().mockResolvedValue(profile),
            assignCourse: jest.fn().mockResolvedValue(undefined),
            deactivateCourse: jest.fn().mockResolvedValue(true),
        },
        availability: {
            listBookableSlots: jest.fn().mockResolvedValue([]),
            listTutorCalendar: jest.fn().mockResolvedValue({ blocks: [], bookings: [] }),
            createBlock: jest.fn().mockResolvedValue("5"),
            updateBlock: jest.fn().mockResolvedValue(undefined),
            withdrawBlock: jest.fn().mockResolvedValue(true),
        },
        booking: {
            getSession: jest.fn().mockResolvedValue({ id: "6", location: "Library" }),
            bookSession: jest.fn().mockResolvedValue("6"),
            listMySessions: jest.fn().mockResolvedValue([]),
            listAdminSessions: jest.fn().mockResolvedValue([]),
            cancelSession: jest.fn().mockResolvedValue(true),
        },
    };
    app.locals.services = services;
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
});

afterEach(async () =>
{
    try
    {
        if (server?.listening)
        {
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }

        await initialized?.disconnectDatabase();
    }
    finally
    {
        jest.restoreAllMocks();
    }
});

/**
 * Send a request to the mounted server.
 * @param path Route path and optional query.
 * @param options HTTP method, signed-in identity, body, or cookie.
 * @returns HTTP response.
 */
function request(path, { method = "GET", actor, claims = [], body, cookie } = {})
{
    const headers = {};
    if (actor)
    {
        headers.Authorization = `Bearer ${signAccessToken({ accountId: actor, sessionId: "test-session", roles: claims })}`;
    }

    if (body !== undefined)
    {
        headers["Content-Type"] = "application/json";
    }

    if (cookie)
    {
        headers.Cookie = cookie;
    }

    return fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method, headers, body: JSON.stringify(body),
    });
}

describe("Auth and users routes", () =>
{
    test("returns access and production refresh credentials on registration and login", async () =>
    {
        const body = { email: profile.email, firstName: profile.firstName, lastName: profile.lastName, password: "sample-password", roles: ["admin"] };
        const registration = await request("/users", { method: "POST", body });
        const login = await request("/auth/login", { method: "POST", body });

        expect(registration.status).toBe(201);
        expect(login.status).toBe(200);
        expect(services.auth.registerStudent).toHaveBeenCalledWith({
            email: body.email, firstName: body.firstName, lastName: body.lastName, password: body.password,
        });
        expect(services.auth.login).toHaveBeenCalledWith(body.email, body.password);
        expect(await registration.json()).toEqual(profile);
        expect(login.headers.get("authorization")).toBe("Bearer test-access");
        expect(login.headers.get("set-cookie")).toMatch(/aggies_refresh=abc\.def;.*Path=\/auth;.*HttpOnly; Secure; SameSite=Lax/i);
        expect(login.headers.get("cache-control")).toBe("no-store");
    });

    test("refreshes and logs out using the cookie without a bearer token", async () =>
    {
        const options = { method: "POST", cookie: "other=ignored; aggies_refresh=abc.def" };
        expect((await request("/auth/refresh", options)).status).toBe(204);
        const logout = await request("/auth/logout", options);

        expect(logout.status).toBe(204);
        expect(services.auth.refresh).toHaveBeenCalledWith("abc.def");
        expect(services.auth.logout).toHaveBeenCalledWith("abc.def");
        expect(logout.headers.get("set-cookie")).toMatch(/^aggies_refresh=;/);
    });

    test("verifies the submitted token and scopes resend to the signed-in account", async () =>
    {
        expect((await request("/auth/verify-email", { method: "POST", body: { token: "token" } })).status).toBe(204);
        expect((await request("/auth/resend-verification", { method: "POST" })).status).toBe(401);
        expect((await request("/auth/resend-verification", { method: "POST", actor: "1", body: { accountId: "3" } })).status).toBe(204);

        expect(services.auth.verifyEmail).toHaveBeenCalledWith("token");
        expect(services.auth.sendVerification).toHaveBeenCalledTimes(1);
        expect(services.auth.sendVerification).toHaveBeenCalledWith("1");
    });

    test("uses current roles for admin lookup even if a token still claims admin", async () =>
    {
        expect((await request("/users/me")).status).toBe(401);
        const me = await request("/users/me", { actor: "1" });
        expect(await me.json()).toEqual({ ...profile, roles: ["student"] });

        expect((await request("/users/3", { actor: "1", claims: ["admin"] })).status).toBe(403);
        expect((await request("/users/3", { actor: "2" })).status).toBe(200);
        expect(services.users.getProfile.mock.calls).toEqual([["1"], ["3"]]);
    });
});

describe("Catalog routes", () =>
{
    test("accepts public catalog reads and parses course filters", async () =>
    {
        expect((await request("/catalog/colleges")).status).toBe(200);
        expect((await request("/catalog/colleges/2/departments")).status).toBe(200);
        expect((await request("/catalog/courses/7")).status).toBe(200);
        expect((await request("/catalog/courses?collegeId=2&search=COMP&limit=3&offset=1")).status).toBe(200);
        expect((await request("/catalog/courses?limit=x")).status).toBe(400);

        expect(services.catalog.listDepartments).toHaveBeenCalledWith("2", undefined);
        expect(services.catalog.getCourse).toHaveBeenCalledWith("7");
        expect(services.catalog.searchCourses).toHaveBeenCalledTimes(1);
        expect(services.catalog.searchCourses).toHaveBeenCalledWith({
            collegeId: "2", search: "COMP", limit: 3, offset: 1, includeArchived: false,
        }, undefined);
    });

    test("requires authentication for archived reads and passes the actor for authorization", async () =>
    {
        services.catalog.listColleges.mockImplementation(async id =>
        {
            if (id !== "2")
            {
                throw new ServiceError(403, "Admin required.");
            }

            return [];
        });

        expect((await request("/catalog/colleges?includeArchived=true")).status).toBe(401);
        expect((await request("/catalog/colleges?includeArchived=true", { actor: "1" })).status).toBe(403);
        expect((await request("/catalog/colleges?includeArchived=true", { actor: "2" })).status).toBe(200);
        expect(services.catalog.listColleges.mock.calls).toEqual([["1"], ["2"]]);
    });

    test.each([["colleges", "college"], ["departments", "department"], ["courses", "course"]])(
        "restricts %s writes to current admins",
        async (collection, kind) =>
        {
            const path = `/catalog/${collection}`;
            const body = { name: "Sample", kind: "ignored" };
            expect((await request(path, { method: "POST", actor: "1", body })).status).toBe(403);
            expect((await request(path, { method: "POST", actor: "2", body })).status).toBe(201);
            expect((await request(path + "/7", { method: "PATCH", actor: "2", body })).status).toBe(204);
            expect((await request(path + "/7", { method: "DELETE", actor: "2" })).status).toBe(204);

            expect(services.catalog.createEntry).toHaveBeenCalledTimes(1);
            expect(services.catalog.createEntry).toHaveBeenCalledWith("2", { ...body, kind });
            expect(services.catalog.updateEntry).toHaveBeenCalledWith("2", "7", { ...body, kind });
            expect(services.catalog.archiveEntry).toHaveBeenCalledWith("2", kind, "7");
        },
    );

    test("validates course import before handing the batch to the service", async () =>
    {
        const options = { method: "POST", actor: "2" };
        const rows = [{ departmentId: "2", subjectCode: "COMP", courseNumber: "101", title: "Intro" }];
        expect((await request("/catalog/courses/import", { ...options, body: [null] })).status).toBe(400);
        const imported = await request("/catalog/courses/import", { ...options, body: rows });

        expect(imported.status).toBe(201);
        expect(await imported.json()).toEqual({ ids: ["7"] });
        expect(services.catalog.importCourses).toHaveBeenCalledTimes(1);
        expect(services.catalog.importCourses).toHaveBeenCalledWith("2", rows);
    });
});

describe("Tutor routes", () =>
{
    test("requires sign-in for discovery and returns only tutor names and IDs", async () =>
    {
        expect((await request("/tutors?courseId=7")).status).toBe(401);
        expect((await request("/tutors", { actor: "1" })).status).toBe(400);
        const result = await request("/tutors?courseId=7", { actor: "1" });

        expect(await result.json()).toEqual([{ id: "3", firstName: profile.firstName, lastName: profile.lastName }]);
        expect(services.tutoring.listCourseTutors).toHaveBeenCalledWith("7");
    });

    test("allows tutors to read only their own course assignments", async () =>
    {
        expect((await request("/tutors/me/courses", { actor: "1", claims: ["tutor"] })).status).toBe(403);
        expect((await request("/tutors/me/courses?tutorId=2", { actor: "3" })).status).toBe(200);
        expect(services.tutoring.listTutorCourses).toHaveBeenCalledWith("3");
    });

    test("allows only current admins to read another tutor's assignments", async () =>
    {
        const path = "/tutors/3/courses";
        expect((await request(path, { actor: "1", claims: ["admin"] })).status).toBe(403);
        expect((await request(path, { actor: "2" })).status).toBe(200);
        expect(services.tutoring.listTutorCourses).toHaveBeenCalledTimes(1);
        expect(services.tutoring.listTutorCourses).toHaveBeenCalledWith("3");
    });

    test("lets current admins provision and manage assignments", async () =>
    {
        const path = "/tutors/3/courses/7";
        const body = { accountId: "3", courseIds: ["7"] };
        expect((await request("/tutors", { method: "POST", actor: "3", body })).status).toBe(403);
        expect((await request("/tutors", { method: "POST", actor: "2", body: {} })).status).toBe(400);
        expect((await request("/tutors", { method: "POST", actor: "2", body })).status).toBe(200);
        expect((await request(path, { method: "PUT", actor: "2" })).status).toBe(204);
        expect((await request(path, { method: "DELETE", actor: "2" })).status).toBe(204);

        expect(services.tutoring.provisionTutor).toHaveBeenCalledTimes(1);
        expect(services.tutoring.provisionTutor).toHaveBeenCalledWith("2", body);
        expect(services.tutoring.assignCourse).toHaveBeenCalledWith("2", "3", "7");
        expect(services.tutoring.deactivateCourse).toHaveBeenCalledWith("2", "3", "7");
    });
});

describe("Availability and booking routes", () =>
{
    test("passes the signed-in actor to confirmed booking detail reads", async () =>
    {
        expect((await request("/bookings/6")).status).toBe(401);
        const result = await request("/bookings/6", { actor: "1" });

        expect(result.status).toBe(200);
        expect(await result.json()).toEqual({ id: "6", location: "Library" });
        expect(result.headers.get("cache-control")).toBe("no-store");
        expect(services.booking.getSession).toHaveBeenCalledWith("1", "6");
    });

    test("checks calendar bounds and passes the signed-in caller for private access", async () =>
    {
        const query = new URLSearchParams(window);
        expect((await request(`/availability/courses/7/slots?${query}`)).status).toBe(401);
        expect((await request("/availability/courses/7/slots", { actor: "1" })).status).toBe(400);
        const slots = await request(`/availability/courses/7/slots?${query}`, { actor: "1" });
        expect(await slots.json()).toEqual([]);
        expect(slots.headers.get("cache-control")).toBe("no-store");
        expect((await request(`/availability/tutors/3/calendar?${query}`, { actor: "2" })).status).toBe(200);
        expect(services.availability.listBookableSlots).toHaveBeenCalledWith("7", window);
        expect(services.availability.listTutorCalendar).toHaveBeenCalledWith("2", "3", window);
    });

    test("takes the block owner from the session and exposes service conflicts", async () =>
    {
        const body = { ...window, location: "Library" };
        expect((await request("/availability/blocks", { method: "POST", actor: "3", body: { ...body, tutorId: "2" } })).status).toBe(201);
        services.availability.updateBlock.mockRejectedValue(new ServiceError(409, "Block contains a booking."));
        const edit = await request("/availability/blocks/5", { method: "PATCH", actor: "3", body });
        expect(edit.status).toBe(409);
        expect(await edit.json()).toEqual({ error: "Block contains a booking." });
        expect((await request("/availability/blocks/5", { method: "DELETE", actor: "3" })).status).toBe(204);
        expect(services.availability.createBlock).toHaveBeenCalledWith("3", body);
        expect(services.availability.updateBlock).toHaveBeenCalledWith("3", "5", body);
        expect(services.availability.withdrawBlock).toHaveBeenCalledWith("3", "5");
    });

    test("uses the caller for booking creation and cancellation", async () =>
    {
        const body = { ...window, courseId: "7", tutorId: "3", availabilityBlockId: "5" };
        const result = await request("/bookings", { method: "POST", actor: "1", body: { ...body, studentId: "2" } });
        expect(result.status).toBe(201);
        expect(await result.json()).toEqual({ id: "6" });
        expect((await request("/bookings/6", { method: "DELETE", actor: "3" })).status).toBe(204);
        expect(services.booking.bookSession).toHaveBeenCalledWith("1", body);
        expect(services.booking.cancelSession).toHaveBeenCalledWith("3", "6");
    });

    test("scopes normal booking lists to the caller and passes participant filters only to the admin service", async () =>
    {
        expect((await request("/bookings")).status).toBe(401);
        expect((await request("/bookings?participantId=3&includeCanceled=true", { actor: "1" })).status).toBe(200);
        expect((await request("/bookings/admin?participantId=3", { actor: "2" })).status).toBe(200);
        expect(services.booking.listMySessions).toHaveBeenCalledWith("1", { limit: 25, offset: 0, includeCanceled: true });
        expect(services.booking.listAdminSessions).toHaveBeenCalledWith("2", {
            limit: 25, offset: 0, includeCanceled: false, participantId: "3",
        });
    });

    test("passes the canceled-only flag only to the admin booking search", async () =>
    {
        expect((await request("/bookings/admin?canceledOnly=true", { actor: "2" })).status).toBe(200);
        expect((await request("/bookings?canceledOnly=true", { actor: "1" })).status).toBe(200);

        expect(services.booking.listAdminSessions).toHaveBeenCalledWith("2", {
            limit: 25, offset: 0, includeCanceled: false, canceledOnly: true,
        });
        expect(services.booking.listMySessions).toHaveBeenCalledWith("1", {
            limit: 25, offset: 0, includeCanceled: false,
        });
    });
});

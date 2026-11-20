import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";

import { requireRole, requireSession, signAccessToken } from "../dist/middleware/jwt.middleware.js";

beforeEach(() =>
{
    // Use a test-only signing secret regardless of the local environment
    jest.replaceProperty(process, "env", { ...process.env, JWT_SECRET: "a".repeat(64) });
});

afterEach(() => jest.restoreAllMocks());

/** Create the Express methods needed by the auth middleware. */
function createResponse()
{
    return {
        locals: {},
        set: jest.fn().mockReturnThis(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
    };
}

test("attaches a verified identity and lets the request continue", () =>
{
    // Use the real signer to exercise bearer token verification
    const identity = { accountId: "1", sessionId: "example-session", roles: ["student"] };
    const req = { get: jest.fn().mockReturnValue(`Bearer ${signAccessToken(identity)}`) };
    const res = createResponse();
    const next = jest.fn();

    requireSession(req, res, next);

    expect(res.locals.session).toEqual(identity);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
});

test.each([undefined, "Bearer invalid"])("rejects an absent or invalid token (%s)", header =>
{
    const req = { get: jest.fn().mockReturnValue(header) };
    const res = createResponse();
    const next = jest.fn();

    requireSession(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
});

test("rejects an authenticated student on an admin-only route", () =>
{
    const res = createResponse();
    res.locals.session = { accountId: "1", roles: ["student"] };
    const next = jest.fn();

    requireRole("admin")({}, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
});

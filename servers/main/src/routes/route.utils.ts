// Copyright 2026, Elias Lopes
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are
// met:
//
//     * Redistributions of source code must retain the above copyright
// notice, this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above
// copyright notice, this list of conditions and the following disclaimer
// in the documentation and/or other materials provided with the
// distribution.
//     * Neither the name of Elias Lopes nor the names of its
// contributors may be used to endorse or promote products derived from
// this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
// FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
// COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
// INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
// BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
// LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
// CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
// LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
// ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.

import { type Request, type RequestHandler, type Response } from "express";

import { type AccountRole } from "../database/models/users.model.js";
import { requireSession } from "../middleware/jwt.middleware.js";
import { ServiceError } from "../services/service.utils.js";
import { type ServiceSet } from "../settings/contracts.js";

/**
 * Get the services attached to the app.
 * @param req Incoming request.
 * @returns Configured service set.
 */
export function getServices(req: Request): ServiceSet
{
    return req.app.locals.services;
}

/**
 * Read the caller ID after session middleware runs.
 * @param res Express response.
 * @returns Authenticated account ID.
 */
export function getActor(res: Response): string
{
    return res.locals.session.accountId;
}

/**
 * Check the caller's current role in MySQL.
 * @param role Role required by the route.
 * @returns Middleware that checks the role after authentication.
 */
export function requireCurrentRole(role: AccountRole): RequestHandler
{
    return async (req, res, next) =>
    {
        const roles = await getServices(req).users.listRoles(getActor(res));
        if (!roles.includes(role))
        {
            throw new ServiceError(403, "Insufficient permissions.");
        }

        next();
    };
}

/**
 * Parse one optional query string.
 * @param value Raw query parameter.
 * @returns Query value when supplied.
 */
export function queryText(value: unknown): string | undefined
{
    if (value !== undefined && typeof value !== "string")
    {
        throw new ServiceError(400, "Expected a single query value.");
    }

    return value;
}

/**
 * Parse a boolean query flag.
 * @param value Raw query parameter.
 * @returns Whether the flag is enabled.
 */
export function queryFlag(value: unknown): boolean
{
    if (value === undefined || value === "false")
    {
        return false;
    }

    if (value !== "true")
    {
        throw new ServiceError(400, "Expected true or false.");
    }

    return true;
}

/**
 * Parse a pagination query value.
 * @param value Raw query parameter.
 * @param fallback Value used when the parameter is absent.
 * @returns Parsed integer.
 */
export function queryInteger(value: unknown, fallback: number): number
{
    const text = queryText(value);
    if (text === undefined)
    {
        return fallback;
    }

    if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)))
    {
        throw new ServiceError(400, "Expected an integer query value.");
    }

    return Number(text);
}

/**
 * Authenticate catalog requests that include archived records.
 * @param req Incoming request.
 * @param res Express response.
 * @param next Next Express handler.
 */
export const authenticateArchived: RequestHandler = (req, res, next) =>
{
    if (queryFlag(req.query.includeArchived))
    {
        return requireSession(req, res, next);
    }

    next();
};

/**
 * Prevent clients from caching private or time-sensitive responses.
 * @param _req Incoming request.
 * @param res Express response.
 * @param next Next Express handler.
 */
export const noStore: RequestHandler = (_req, res, next) =>
{
    res.set("Cache-Control", "no-store");
    next();
};

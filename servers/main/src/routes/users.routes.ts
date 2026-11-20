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

import { Router, type RequestHandler } from "express";

import { requireRole, requireSession } from "../middleware/jwt.middleware.js";
import { authRateLimit, sendAuthSession } from "./auth.routes.js";
import { type ServiceSet } from "../settings/contracts.js";

const usersRouter = Router();

// Cache keys use <resource>:<id>:<data>, such as users:<id>:profile
// Profiles expire after five minutes and fall back to MySQL on a cache miss

/**
 * Register a student account.
 */
const registerStudent: RequestHandler = async (req, res) =>
{
    const { email, firstName, lastName, password } = req.body ?? {};
    const services: ServiceSet = req.app.locals.services;
    const result = await services.auth.registerStudent({ email, firstName, lastName, password });
    sendAuthSession(res, result);
    res.status(201).json(result.profile);
};

/**
 * Return the signed-in account or an account requested by an admin.
 */
const getAccount: RequestHandler<{ accountId?: string }> = async (req, res) =>
{
    const accountId: string = req.params.accountId ?? res.locals.session.accountId;
    if (!/^[1-9][0-9]{0,18}$/.test(accountId) || BigInt(accountId) > 9_223_372_036_854_775_807n)
    {
        res.status(400).json({ error: "Invalid account ID." });
        return;
    }

    const services: ServiceSet = req.app.locals.services;
    const profile = await services.users.getProfile(accountId);
    if (!profile)
    {
        res.status(404).json({ error: "Account not found." });
        return;
    }

    const roles = await services.users.listRoles(accountId);
    res.json({ ...profile, roles });
};

// Register a student and return an access 
// token without checking the profile cache
usersRouter.post("/", authRateLimit, registerStudent);

// Get the signed-in user's cached 
// profile and load current roles from MySQL
usersRouter.get("/me", requireSession, getAccount);

// Let admins use the same profile 
// cache and load current roles from MySQL
usersRouter.get("/:accountId", requireSession, requireRole("admin"), getAccount);

export default usersRouter;

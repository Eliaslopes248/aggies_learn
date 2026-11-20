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

import { Router, type RequestHandler, type Response } from "express";
import { rateLimit } from "express-rate-limit";

import { requireSession } from "../middleware/jwt.middleware.js";
import { type ServiceSet } from "../settings/contracts.js";
import { ServiceError } from "../services/service.utils.js";

const authRouter = Router();
const refreshCookieName = "aggies_refresh";

export const authRateLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
});

/** Set the access header and optional browser refresh cookie. */
export function sendAuthSession(res: Response, session: {
    accessToken: string;
    refreshToken?: string;
    refreshExpiresAt?: number;
}): void
{
    res.set("Authorization", `Bearer ${session.accessToken}`).set("Cache-Control", "no-store");
    if (session.refreshToken && session.refreshExpiresAt)
    {
        res.cookie(refreshCookieName, session.refreshToken, {
            httpOnly: true,
            sameSite: "lax",
            secure: res.req.app.locals.settings.appMode === "prod",
            path: "/auth",
            expires: new Date(session.refreshExpiresAt),
        });
    }
}

/** Read the opaque refresh token from the browser cookie. */
function readRefreshCookie(header: string | undefined): string
{
    return header?.match(/(?:^|;\s*)aggies_refresh=([a-f0-9.-]+)(?:;|$)/)?.[1] ?? "";
}

/** Sign in with an email and password. */
const login: RequestHandler = async (req, res) =>
{
    const services: ServiceSet = req.app.locals.services;
    const { email, password } = req.body ?? {};
    const result = await services.auth.login(email, password);
    sendAuthSession(res, result);
    res.json(result.profile);
};

/** Renew the session using its refresh cookie. */
const refresh: RequestHandler = async (req, res) =>
{
    const services: ServiceSet = req.app.locals.services;
    const result = await services.auth.refresh(readRefreshCookie(req.get("Cookie")));
    sendAuthSession(res, result);
    res.status(204).end();
};

/** Revoke the refresh session and remove its cookie. */
const logout: RequestHandler = async (req, res) =>
{
    const services: ServiceSet = req.app.locals.services;
    const token = readRefreshCookie(req.get("Cookie"));
    if (token)
    {
        try
        {
            await services.auth.logout(token);
        }
        catch (error)
        {
            if (!(error instanceof ServiceError) || error.status !== 401)
            {
                throw error;
            }
        }
    }

    res.clearCookie(refreshCookieName, {
        httpOnly: true,
        sameSite: "lax",
        secure: req.app.locals.settings.appMode === "prod",
        path: "/auth",
    });
    res.status(204).end();
};

/** Confirm a verification token submitted by the client. */
const verifyEmail: RequestHandler = async (req, res) =>
{
    const services: ServiceSet = req.app.locals.services;
    await services.auth.verifyEmail(req.body?.token);
    res.status(204).end();
};

/** Send another verification link for the signed-in account. */
const resendVerification: RequestHandler = async (req, res) =>
{
    const services: ServiceSet = req.app.locals.services;
    await services.auth.sendVerification(res.locals.session.accountId);
    res.status(204).end();
};

// Auth responses bypass HTTP caching. Redis keys use auth:sessions:<sid>
// and auth:email-verification:<token-hash> with fixed expirations.
authRouter.use((_req, res, next) =>
{
    res.set("Cache-Control", "no-store");
    next();
});

// Verify credentials and create a session
authRouter.post("/login", authRateLimit, login);

// Rotate the refresh token and issue a new access JWT
authRouter.post("/refresh", refresh);

// Revoke the current refresh session
authRouter.post("/logout", logout);

// Verify a student's email address
authRouter.post("/verify-email", authRateLimit, verifyEmail);

// Send another verification link
authRouter.post("/resend-verification", requireSession, authRateLimit, resendVerification);

export default authRouter;

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


import { type RequestHandler } from "express";
import jwt from "jsonwebtoken";

// Default access token lifetime in seconds
const ACCESS_TOKEN_TTL_SECONDS = 1_000;
const TOKEN_ISSUER = "aggies-learn";
const TOKEN_AUDIENCE = "aggies-learn-api";

type AccountRole = "student" | "tutor" | "admin";

type SessionIdentity = {
    accountId: string;
    sessionId: string;
    roles: AccountRole[];
};

/**
 * Get the configured JWT signing secret.
 * @returns Secret used by the API to sign and verify access tokens.
 */
export function getJWTSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret || Buffer.byteLength(secret.trim()) < 32) {
        throw new Error("JWT_SECRET must be at least 32 bytes.");
    }

    return secret;
}

/**
 * Check whether a token role is supported.
 * @param role Role read from the token.
 */
function isAccountRole(role: unknown): role is AccountRole {
    return role === "student" || role === "tutor" || role === "admin";
}

/**
 * Sign an access token for a session.
 * @param session Authenticated session identity.
 * @returns Signed access token.
 */
export function signAccessToken(session: SessionIdentity): string {
    return jwt.sign({
        sub: session.accountId,
        sid: session.sessionId,
        roles: session.roles,
    }, getJWTSecret(), {
        algorithm: "HS256",
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
    });
}

/**
 * Verify an access token and return its session identity.
 * @param token Access token to verify.
 * @returns Verified session identity.
 */
export function verifyAccessToken(token: string): SessionIdentity {
    const payload = jwt.verify(token, getJWTSecret(), {
        algorithms: ["HS256"],
        issuer: TOKEN_ISSUER,
        audience: TOKEN_AUDIENCE,
    });

    // Check the session claims before attaching them to the request
    if (
        typeof payload === "string" ||
        typeof payload.exp !== "number" || !Number.isFinite(payload.exp) ||
        typeof payload.sub !== "string" || !payload.sub.trim() ||
        typeof payload.sid !== "string" || !payload.sid.trim() ||
        !Array.isArray(payload.roles) || !payload.roles.every(isAccountRole)
    ) 
    {
        throw new jwt.JsonWebTokenError("Invalid session claims.");
    }

    return { accountId: payload.sub, sessionId: payload.sid, roles: payload.roles };
}

/**
 * Require a valid session and attach it to res.locals.
 */
export const requireSession: RequestHandler = (req, res, next) => {
    const token = req.get("Authorization")?.match(/^Bearer +([^\s,]+)$/i)?.[1];
    if (!token) 
    {
        res.set("WWW-Authenticate", "Bearer").status(401).json({ error: "Sign in required." });
        return;
    }

    try 
    {
        res.locals.session = verifyAccessToken(token);
    } 
    catch (error) 
    {
        if (!(error instanceof jwt.JsonWebTokenError)) 
        {
            next(error);
            return;
        }

        res.set("WWW-Authenticate", 'Bearer error="invalid_token"')
            .status(401).json({ error: "Invalid or expired access token." });
        return;
    }

    next();
};

/**
 * Require at least one of the given roles.
 * @param roles Roles allowed to access the route.
 * @returns Role-check middleware.
 */
export function requireRole(...roles: AccountRole[]): RequestHandler {
    return (_req, res, next) => {
        const session: SessionIdentity | undefined = res.locals.session;
        if (!session) {
            res.set("WWW-Authenticate", "Bearer").status(401).json({ error: "Sign in required." });
            return;
        }

        if (!roles.some(role => session.roles.includes(role))) {
            res.status(403).json({ error: "Insufficient permissions." });
            return;
        }

        next();
    };
}


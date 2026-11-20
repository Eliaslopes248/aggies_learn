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

import { ServiceError } from "./service.utils.js";

export type TimeWindow = { startsAt: string; endsAt: string };

export const sessionDurationMs = 30 * 60_000;
export const bookingLeadTimeMs = 15 * 60_000;
const maxWindowMs = 31 * 24 * 60 * 60_000;

/**
 * Convert a UTC scheduling timestamp to milliseconds.
 * @param timestamp ISO 8601 timestamp in UTC.
 * @returns Milliseconds since the Unix epoch.
 */
export function getTime(timestamp: string): number
{
    const match = typeof timestamp === "string"
        ? /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,6})?Z$/.exec(timestamp)
        : null;
    const time = match ? Date.parse(timestamp) : NaN;
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) !== match?.[1])
    {
        throw new ServiceError(400, "Use valid ISO 8601 UTC timestamps.");
    }

    return time;
}

/**
 * Validate and return the bounds of a calendar window.
 * @param window UTC start and end timestamps.
 * @returns Validated bounds in milliseconds since the Unix epoch.
 */
export function getWindow(window: TimeWindow): { start: number; end: number }
{
    const start = getTime(window.startsAt);
    const end = getTime(window.endsAt);
    if (start >= end || end - start > maxWindowMs)
    {
        throw new ServiceError(400, "A calendar window must be between zero and 31 days.");
    }

    return { start, end };
}

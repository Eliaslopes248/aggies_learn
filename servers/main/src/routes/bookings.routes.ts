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

import { Router, type Request } from "express";

import { type BookingSearch } from "../database/repositories/interfaces/bookings.interface.js";
import { requireSession } from "../middleware/jwt.middleware.js";
import { getActor, getServices, noStore, queryFlag, queryInteger, queryText } from "./route.utils.js";

const bookingsRouter = Router();

// Read private booking data from MySQL on every request.
bookingsRouter.use(noStore, requireSession);

/**
 * Read the booking list filters from the query.
 * @param req Incoming request.
 * @returns Parsed filters and pagination.
 */
function getFilters(req: Request): BookingSearch
{
    const { tutorId, courseId, startsAt, endsAt } = req.query;
    return {
        limit: queryInteger(req.query.limit, 25),
        offset: queryInteger(req.query.offset, 0),
        includeCanceled: queryFlag(req.query.includeCanceled),
        ...Object.fromEntries(Object.entries({
            tutorId: queryText(tutorId), courseId: queryText(courseId),
            startsAt: queryText(startsAt), endsAt: queryText(endsAt),
        }).filter(([, value]) => value !== undefined)),
    };
}

// Create a booking for the verified student in the session.
bookingsRouter.post("/", async (req, res) =>
{
    const { courseId, tutorId, availabilityBlockId, startsAt, endsAt } = req.body ?? {};
    const id = await getServices(req).booking.bookSession(
        getActor(res), { courseId, tutorId, availabilityBlockId, startsAt, endsAt },
    );
    res.status(201).json({ id });
});

// List only the caller's bookings across both participant roles.
bookingsRouter.get("/", async (req, res) =>
{
    res.json(await getServices(req).booking.listMySessions(getActor(res), getFilters(req)));
});

// Let admins filter bookings across participants.
bookingsRouter.get("/admin", async (req, res) =>
{
    const filters = getFilters(req);
    if (queryFlag(req.query.canceledOnly))
    {
        filters.canceledOnly = true;
    }

    const participantId = queryText(req.query.participantId);
    if (participantId !== undefined)
    {
        filters.participantId = participantId;
    }

    res.json(await getServices(req).booking.listAdminSessions(getActor(res), filters));
});

// Read the confirmed booking details as a participant or admin.
bookingsRouter.get("/:bookingId", async (req, res) =>
{
    res.json(await getServices(req).booking.getSession(getActor(res), req.params.bookingId));
});

// Cancel a booking as a participant or admin.
bookingsRouter.delete("/:bookingId", async (req, res) =>
{
    await getServices(req).booking.cancelSession(getActor(res), req.params.bookingId);
    res.status(204).end();
});

export default bookingsRouter;

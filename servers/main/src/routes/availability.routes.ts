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

import { requireSession } from "../middleware/jwt.middleware.js";
import { ServiceError } from "../services/service.utils.js";
import { getActor, getServices, noStore, queryText } from "./route.utils.js";

const availabilityRouter = Router();

// Read the current calendar without caching slots or private bookings.
availabilityRouter.use(noStore, requireSession);

/**
 * Read the requested calendar window.
 * @param req Incoming request with UTC window bounds.
 * @returns Calendar start and end.
 */
function getWindow(req: Request)
{
    const startsAt = queryText(req.query.startsAt);
    const endsAt = queryText(req.query.endsAt);
    if (!startsAt || !endsAt)
    {
        throw new ServiceError(400, "Provide both calendar window bounds.");
    }

    return { startsAt, endsAt };
}

// List bookable slots for any signed-in role.
availabilityRouter.get("/courses/:courseId/slots", async (req, res) =>
{
    res.json(await getServices(req).availability.listBookableSlots(req.params.courseId, getWindow(req)));
});

// Show a private calendar to the owning tutor or an admin.
availabilityRouter.get("/tutors/:tutorId/calendar", async (req, res) =>
{
    res.json(await getServices(req).availability.listTutorCalendar(getActor(res), req.params.tutorId, getWindow(req)));
});

// Publish a block for the signed-in tutor.
availabilityRouter.post("/blocks", async (req, res) =>
{
    const { startsAt, endsAt, location } = req.body ?? {};
    const id = await getServices(req).availability.createBlock(getActor(res), { startsAt, endsAt, location });
    res.status(201).json({ id });
});

// Edit an owned block while preserving booked time.
availabilityRouter.patch("/blocks/:blockId", async (req, res) =>
{
    const { startsAt, endsAt, location } = req.body ?? {};
    await getServices(req).availability.updateBlock(getActor(res), req.params.blockId, { startsAt, endsAt, location });
    res.status(204).end();
});

// Withdraw an owned block from future scheduling.
availabilityRouter.delete("/blocks/:blockId", async (req, res) =>
{
    await getServices(req).availability.withdrawBlock(getActor(res), req.params.blockId);
    res.status(204).end();
});

export default availabilityRouter;

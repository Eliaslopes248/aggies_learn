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

import { Router } from "express";

import { requireSession } from "../middleware/jwt.middleware.js";
import { ServiceError } from "../services/service.utils.js";
import { getActor, getServices, noStore, queryInteger, queryText, requireCurrentRole } from "./route.utils.js";

const tutorsRouter = Router();

// Use current assignments from MySQL and existing cache-backed profile reads.
tutorsRouter.use(noStore, requireSession);

// List a tutor's own active course assignments.
tutorsRouter.get("/me/courses", requireCurrentRole("tutor"), async (req, res) =>
{
    res.json(await getServices(req).tutoring.listTutorCourses(getActor(res)));
});

// Read the admin directory directly from MySQL so search and metadata stay current.
tutorsRouter.get("/admin", requireCurrentRole("admin"), async (req, res) =>
{
    const { search, limit, offset } = req.query;
    res.json(await getServices(req).users.listTutors(
        queryText(search) ?? "",
        queryInteger(limit, 25),
        queryInteger(offset, 0),
    ));
});

// Update the tutor name and invalidate the cached account profile.
tutorsRouter.patch("/:tutorId", requireCurrentRole("admin"), async (req, res) =>
{
    const { firstName, lastName } = req.body ?? {};
    await getServices(req).users.updateTutorName(queryText(req.params.tutorId) ?? "", firstName, lastName);
    res.status(204).end();
});

// Let admins review a tutor's active assignments before making changes.
tutorsRouter.get("/:tutorId/courses", requireCurrentRole("admin"), async (req, res) =>
{
    res.json(await getServices(req).tutoring.listTutorCourses(queryText(req.params.tutorId) ?? ""));
});

// List course tutors with only their IDs and names.
tutorsRouter.get("/", async (req, res) =>
{
    const courseId = queryText(req.query.courseId);
    if (!courseId)
    {
        throw new ServiceError(400, "Provide a course ID.");
    }

    const { tutoring, users } = getServices(req);
    const assignments = await tutoring.listCourseTutors(courseId);
    const tutors = await Promise.all(assignments.map(async ({ tutorId }) =>
    {
        const roles = await users.listRoles(tutorId);
        const profile = roles.includes("tutor") ? await users.getProfile(tutorId) : null;
        return profile && { id: profile.id, firstName: profile.firstName, lastName: profile.lastName };
    }));
    res.json(tutors.filter(tutor => tutor !== null));
});

// Provision a hired tutor and assign their courses.
tutorsRouter.post("/", requireCurrentRole("admin"), async (req, res) =>
{
    const { accountId, email, firstName, lastName, password, courseIds } = req.body ?? {};
    if (!Array.isArray(courseIds) || courseIds.length > 100)
    {
        throw new ServiceError(400, "Provide an array of up to 100 course IDs.");
    }

    const input = accountId === undefined
        ? { email, firstName, lastName, password, courseIds }
        : { accountId, courseIds };
    res.json(await getServices(req).tutoring.provisionTutor(getActor(res), input));
});

// Assign or reactivate a tutor's course.
tutorsRouter.put("/:tutorId/courses/:courseId", requireCurrentRole("admin"), async (req, res) =>
{
    await getServices(req).tutoring.assignCourse(getActor(res), queryText(req.params.tutorId) ?? "", queryText(req.params.courseId) ?? "");
    res.status(204).end();
});

// Deactivate an assignment and keep its booking history.
tutorsRouter.delete("/:tutorId/courses/:courseId", requireCurrentRole("admin"), async (req, res) =>
{
    await getServices(req).tutoring.deactivateCourse(getActor(res), queryText(req.params.tutorId) ?? "", queryText(req.params.courseId) ?? "");
    res.status(204).end();
});

export default tutorsRouter;

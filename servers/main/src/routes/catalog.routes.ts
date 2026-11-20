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
import {
    authenticateArchived, getActor, getServices, noStore, queryFlag, queryInteger, queryText, requireCurrentRole,
} from "./route.utils.js";

const catalogRouter = Router();
const adminOnly = [requireSession, requireCurrentRole("admin")] as const;

// Read catalog data from MySQL so edits are visible on the next request.
catalogRouter.use(noStore);

// List active colleges, with archives available to admins.
catalogRouter.get("/colleges", authenticateArchived, async (req, res) =>
{
    const adminId = queryFlag(req.query.includeArchived) ? getActor(res) : undefined;
    res.json(await getServices(req).catalog.listColleges(adminId));
});

// List departments in the requested college.
catalogRouter.get("/colleges/:collegeId/departments", authenticateArchived, async (req, res) =>
{
    const adminId = queryFlag(req.query.includeArchived) ? getActor(res) : undefined;
    res.json(await getServices(req).catalog.listDepartments(queryText(req.params.collegeId) ?? "", adminId));
});

// Search courses with bounded pagination.
catalogRouter.get("/courses", authenticateArchived, async (req, res) =>
{
    const { collegeId, departmentId, search, limit, offset, includeArchived } = req.query;
    const filters = {
        limit: queryInteger(limit, 25),
        offset: queryInteger(offset, 0),
        includeArchived: queryFlag(includeArchived),
        ...Object.fromEntries(Object.entries({
            collegeId: queryText(collegeId), departmentId: queryText(departmentId), search: queryText(search),
        }).filter(([, value]) => value !== undefined)),
    };
    res.json(await getServices(req).catalog.searchCourses(filters, filters.includeArchived ? getActor(res) : undefined));
});

// Return a course with an active department and college.
catalogRouter.get("/courses/:courseId", async (req, res) =>
{
    res.json(await getServices(req).catalog.getCourse(req.params.courseId));
});

// Import a bounded batch of courses in one transaction.
catalogRouter.post("/courses/import", ...adminOnly, async (req, res) =>
{
    const rows = req.body;
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 100 ||
        rows.some(row => !row || typeof row !== "object" || Array.isArray(row)))
    {
        throw new ServiceError(400, "Provide an array of 1 to 100 course records.");
    }

    const ids = await getServices(req).catalog.importCourses(getActor(res), rows);
    res.status(201).json({ ids });
});

for (const [collection, kind] of [["colleges", "college"], ["departments", "department"], ["courses", "course"]] as const)
{
    // Create a catalog entry in the selected collection.
    catalogRouter.post(`/${collection}`, ...adminOnly, async (req, res) =>
    {
        const id = await getServices(req).catalog.createEntry(getActor(res), { ...req.body, kind });
        res.status(201).json({ id });
    });

    // Replace the editable fields of an existing entry.
    catalogRouter.patch(`/${collection}/:id`, ...adminOnly, async (req, res) =>
    {
        const updated = await getServices(req).catalog.updateEntry(getActor(res), queryText(req.params.id) ?? "", { ...req.body, kind });
        if (!updated)
        {
            throw new ServiceError(404, "Catalog entry not found.");
        }

        res.status(204).end();
    });

    // Archive the entry and keep its existing references.
    catalogRouter.delete(`/${collection}/:id`, ...adminOnly, async (req, res) =>
    {
        await getServices(req).catalog.archiveEntry(getActor(res), kind, queryText(req.params.id) ?? "");
        res.status(204).end();
    });
}

export default catalogRouter;

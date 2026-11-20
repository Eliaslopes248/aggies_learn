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

import { type PoolConnection } from "mysql2/promise";
import { type AvailabilityBlock } from "../../models/appointments.model.js";

export type AvailabilityDetails = Pick<AvailabilityBlock, "startsAt" | "endsAt" | "location">;

export interface IAvailabilityRepository
{
    /** Create an availability block and return its ID. */
    createBlock(tutorId: string, block: AvailabilityDetails): Promise<string>;

    /** Find an availability block by ID. */
    findBlock(id: string): Promise<AvailabilityBlock | null>;

    /** Lock an availability block before booking or editing it. */
    lockBlock(id: string, connection: PoolConnection): Promise<AvailabilityBlock | null>;

    /** List a tutor’s blocks overlapping a calendar window. */
    listBlocks(tutorId: string, startsAt: string, endsAt: string, includeWithdrawn?: boolean): Promise<AvailabilityBlock[]>;

    /** Edit an open block owned by the tutor. */
    updateBlock(id: string, tutorId: string, block: AvailabilityDetails, connection: PoolConnection): Promise<boolean>;

    /** Withdraw an open block owned by the tutor. */
    withdrawBlock(id: string, tutorId: string, connection: PoolConnection): Promise<boolean>;
}

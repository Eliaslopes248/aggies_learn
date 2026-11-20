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

import { type Express } from "express";

import { type IAvailabilityRepository } from "../database/repositories/interfaces/availability.interface.js";
import { type IBookingRepository } from "../database/repositories/interfaces/bookings.interface.js";
import { type ICatalogRepository } from "../database/repositories/interfaces/catalog.interface.js";
import { type IEmailOutboxRepository } from "../database/repositories/interfaces/email-outbox.interface.js";
import { type ITutorAssignmentRepository } from "../database/repositories/interfaces/tutor-assignments.interface.js";
import { type IUserRepository } from "../database/repositories/interfaces/users.interface.js";
import { type AuthService } from "../services/auth.service.js";
import { type AvailabilityService } from "../services/availability.service.js";
import { type BookingService } from "../services/booking.service.js";
import { type CatalogService } from "../services/catalog.service.js";
import { type EmailDeliveryService } from "../services/email-delivery.service.js";
import { type TutoringService } from "../services/tutoring.service.js";
import { type UserService } from "../services/users.service.js";

// Type that contains all repositories
export interface RepositorySet {
    users: IUserRepository;
    availability: IAvailabilityRepository;
    bookings: IBookingRepository;
    catalog: ICatalogRepository;
    emailOutbox: IEmailOutboxRepository;
    tutorAssignments: ITutorAssignmentRepository;
};

// Type that contains all service interfaces
export interface ServiceSet {
    users: UserService;
    auth: AuthService;
    availability: AvailabilityService;
    booking: BookingService;
    catalog: CatalogService;
    emailDelivery?: EmailDeliveryService;
    tutoring: TutoringService;
};

// Server and its database cleanup
export interface InitializedServer {
    app: Express;
    disconnectDatabase: () => Promise<void>;
}


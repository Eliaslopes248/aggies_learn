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

import dotenv from "dotenv";
import express, { type ErrorRequestHandler, type Express } from "express";
import helmet from "helmet";

import { MySQLService } from "../database/mysql.service.js";
import { RedisService } from "../database/redis.service.js";
import { MySQLAvailabilityRepository } from "../database/repositories/mysql/availability.repository.js";
import { MySQLBookingRepository } from "../database/repositories/mysql/bookings.repository.js";
import { MySQLCatalogRepository } from "../database/repositories/mysql/catalog.repository.js";
import { MySQLEmailOutboxRepository } from "../database/repositories/mysql/email-outbox.repository.js";
import { MySQLTutorAssignmentRepository } from "../database/repositories/mysql/tutor-assignments.repository.js";
import { MySQLUserRepository } from "../database/repositories/mysql/users.repository.js";
import { createTransactionRunner, type RunTransaction } from "../database/transaction.js";
import availabilityRouter from "../routes/availability.routes.js";
import bookingsRouter from "../routes/bookings.routes.js";
import catalogRouter from "../routes/catalog.routes.js";
import tutorsRouter from "../routes/tutors.routes.js";
import authRouter from "../routes/auth.routes.js";
import usersRouter from "../routes/users.routes.js";
import { AuthService } from "../services/auth.service.js";
import { AvailabilityService } from "../services/availability.service.js";
import { BookingService } from "../services/booking.service.js";
import { CatalogService } from "../services/catalog.service.js";
import { EmailDeliveryService } from "../services/email-delivery.service.js";
import { TutoringService } from "../services/tutoring.service.js";
import { ServiceError } from "../services/service.utils.js";
import { createSMTPEmailProvider } from "../services/smtp-email.provider.js";
import { UserService } from "../services/users.service.js";
import { type InitializedServer, type RepositorySet, type ServiceSet } from "./contracts.js";
import { type AppSettings } from "./types.js";


function getAppSettings() : AppSettings {

    // load system variables
    dotenv.config({ quiet: true });

    // get app settings
    const appMode = process.env.APP_MODE ?? "dev";
    const databaseServiceType = process.env.DB_SVC_TYPE ?? "mysql";
    const redisURL = process.env.REDIS_URL?.trim();

    if (appMode !== "dev" && appMode !== "prod") 
    {
        throw new Error("APP_MODE must be dev or prod.");
    }

    if (databaseServiceType !== "mysql") 
    {
        throw new Error("DB_SVC_TYPE must be mysql.");
    }

    return { 
            appMode, 
            databaseServiceType, 
            ...(redisURL ? { redisURL } : {}) 
        };
}

/**
 * Attach middleware configuration to server.
 * @param app 
 */
function attachMiddleware(app: Express, settings: AppSettings) : void {
    // Add helmet HTTP headers to server
    app.use(helmet());
    app.use(express.json({ limit: "16kb" }));
}

/**
 * Attach helper services to the server.
 * @param app Express application.
 * @param repositories Configured repositories.
 * @param transaction Shared MySQL transaction runner.
 * @param settings Application settings.
 */
function attachServices(app: Express, repositories: RepositorySet, transaction: RunTransaction, settings: AppSettings): ServiceSet
{
    const { users, catalog, tutorAssignments, availability, bookings, emailOutbox } = repositories;
    const userService = new UserService(users);
    const smtpURL = process.env.SMTP_URL;
    const from = process.env.MAIL_FROM;
    const mail = smtpURL && from ? createSMTPEmailProvider(smtpURL, from) : undefined;
    const services: ServiceSet = {
        users: userService,
        auth: new AuthService(users, userService, {
            redisEnabled: Boolean(settings.redisURL),
            campusEmailDomain: process.env.CAMPUS_EMAIL_DOMAIN,
            verificationURL: process.env.VERIFICATION_URL,
            mail,
        }),
        catalog: new CatalogService(catalog, users, transaction),
        tutoring: new TutoringService(users, catalog, tutorAssignments, transaction),
        availability: new AvailabilityService(users, catalog, tutorAssignments, availability, bookings, transaction),
        booking: new BookingService(users, catalog, tutorAssignments, availability, bookings, emailOutbox, transaction),
        ...(mail ? { emailDelivery: new EmailDeliveryService(emailOutbox, bookings, users, mail) } : {}),
    };
    app.locals.services = services;
    return services;
}

/** Attach feature routes to the server. */
function attachSubRoutes(app: Express): void
{
    app.use("/auth", authRouter);
    app.use("/users", usersRouter);
    app.use("/catalog", catalogRouter);
    app.use("/tutors", tutorsRouter);
    app.use("/availability", availabilityRouter);
    app.use("/bookings", bookingsRouter);
}

/** Return service errors as JSON and pass unexpected failures to Express. */
const handleServiceError: ErrorRequestHandler = (error, _req, res, next) =>
{
    if (error instanceof ServiceError)
    {
        res.status(error.status).json({ error: error.message });
        return;
    }

    next(error);
};

/**
 * Will create the main server from app
 * configuration.
 * 
 * @returns Configured server and database cleanup, or null on startup failure.
 */
export async function createServer(): Promise<InitializedServer | null>
{

    // create server
    const app = express();
    let database: MySQLService | undefined;

    try
    {
        const settings = getAppSettings()
        app.locals.settings = settings;

        // Select the database service and its repositories
        let repositories: RepositorySet;
        switch (settings.databaseServiceType)
        {
            case "mysql":
            default:
            {
                const password = process.env.MYSQL_PASSWORD;
                if (password === undefined || password.length === 0)
                {
                    throw new Error("MYSQL_PASSWORD must be set.");
                }

                database = new MySQLService({
                    host: process.env.MYSQL_HOST ?? "127.0.0.1",
                    user: process.env.MYSQL_USER ?? "admin",
                    database: process.env.MYSQL_DATABASE ?? "aggie_learning_lounge",
                    password,
                });
                await database.connect();
                repositories = {
                    users: new MySQLUserRepository(database),
                    availability: new MySQLAvailabilityRepository(database),
                    bookings: new MySQLBookingRepository(database),
                    catalog: new MySQLCatalogRepository(database),
                    emailOutbox: new MySQLEmailOutboxRepository(database),
                    tutorAssignments: new MySQLTutorAssignmentRepository(database),
                };
                break;
            }
        }

        // add server confirguration
        attachMiddleware(app, settings);
        const services = attachServices(app, repositories, createTransactionRunner(database), settings);
        attachSubRoutes(app);
        app.use(handleServiceError);

        // Connect Redis when configured
        if (settings.redisURL) 
        {
            await RedisService.configureRedis({ url: settings.redisURL });
        }

        services.emailDelivery?.start();
        const connectedDatabase = database;
        return {
            app,
            disconnectDatabase: async () =>
            {
                try
                {
                    await services.emailDelivery?.stop();
                }
                finally
                {
                    await connectedDatabase.disconnect();
                }
            },
        };
    }
    catch(error) 
    {
        console.error("Unable to create app instance:", error);
        await database?.disconnect().catch(cleanupError => {
            console.error("Unable to disconnect MySQL:", cleanupError);
        });
        return null;
    }
}

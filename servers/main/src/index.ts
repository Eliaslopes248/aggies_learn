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

import { createServer as createHttpServer } from "node:http";

import { RedisService } from "./database/redis.service.js";
import { createServer } from "./settings/server.settings.js";

const shutdownTimeoutMs = 10_000;

/**
 * Start the main HTTP server.
 */
async function runServer(): Promise<void> {

    // Create server instance
    const initializedServer = await createServer();
    if (!initializedServer) {
        process.exitCode = 1;
        return;
    }

    const { app, disconnectDatabase } = initializedServer;

    /**
     * Close MySQL and Redis connections.
     */
    async function disconnectServices(): Promise<void>
    {
        await Promise.all([disconnectDatabase(), RedisService.disconnect()]);
    }

    // Get the configured port
    const port = Number(process.env.PORT ?? "3000");
    if (!Number.isInteger(port) || port < 0 || port > 65535 || process.env.PORT?.trim() === "") {
        console.error("PORT must be an integer between 0 and 65535.");
        process.exitCode = 1;
        await disconnectServices();
        return;
    }

    const server = createHttpServer(app);
    let shuttingDown = false;

    /**
     * Stop the server after active requests finish.
     * @param reason Reason for shutting down the server.
     */
    function shutdown(reason: string): void {
        if (shuttingDown) {
            return;
        }

        shuttingDown = true;
        console.log(`Shutting down HTTP server (${reason}).`);

        // Close remaining connections if shutdown times out
        const timeout = setTimeout(() => {
            console.error("HTTP shutdown timed out. Closing remaining connections.");
            process.exitCode = 1;
            server.closeAllConnections();
        }, shutdownTimeoutMs);
        timeout.unref();

        server.close(error => {
            clearTimeout(timeout);
            if (error) {
                console.error("Unable to close HTTP server:", error);
                process.exitCode = 1;
            }

            // Close database connections after active requests finish
            void disconnectServices().catch(reportServerError).finally(removeSignalHandlers);
        });
    }

    const onInterrupt = () => shutdown("SIGINT");
    const onTerminate = () => shutdown("SIGTERM");

    /**
     * Remove the process signal handlers.
     */
    function removeSignalHandlers(): void {
        process.off("SIGINT", onInterrupt);
        process.off("SIGTERM", onTerminate);
    }

    // Handle Ctrl-C and container stop
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onTerminate);

    server.on("error", error => {
        reportServerError(error);
        if (server.listening) {
            shutdown("server error");
        } else {
            void disconnectServices().catch(reportServerError).finally(removeSignalHandlers);
        }
    });

    server.listen(port, () => {
        const address = server.address();
        if (address && typeof address !== "string") {
            console.log(`HTTP server listening on port ${address.port}.`);
        }
    });
}

/**
 * Report a server failure and set the exit code.
 * @param error Server error.
 */
function reportServerError(error: unknown): void {
    console.error("Server error:", error);
    process.exitCode = 1;
}

void runServer().catch(reportServerError);

import { type PoolConnection, type RowDataPacket } from "mysql2/promise";

/**
 * Convert an ISO 8601 UTC timestamp to a MySQL DATETIME value.
 * @param timestamp UTC timestamp with up to six fractional digits.
 */
export function toMySQLDateTime(timestamp: string): string
{
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(timestamp))
    {
        throw new TypeError("Expected an ISO 8601 UTC timestamp.");
    }

    return timestamp.slice(0, -1).replace("T", " ");
}

/**
 * Get the auto-generated ID on the connection that performed the insert.
 * @param connection Connection that performed the insert.
 */
export async function getInsertedId(connection: PoolConnection): Promise<string>
{
    const [[row]] = await connection.query<(RowDataPacket & { id: string })[]>(
        "SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id",
    );
    if (!row)
    {
        throw new Error("Unable to read the inserted ID.");
    }

    return row.id;
}

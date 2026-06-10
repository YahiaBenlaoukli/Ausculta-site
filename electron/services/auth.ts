import { getDatabase } from "../db/db";
import type { User } from "../../types/user";

export async function createUser(user: User) {
    try {
        const db = getDatabase();
        const stmt = db.prepare(`
        INSERT INTO users (full_name, phone_number, password, role)
        VALUES (?, ?, ?, ?)
    `);
        const result = stmt.run(user.fullName, user.phoneNumber, user.password, user.role);
        return {
            status: 'success', data:
            ...user,
            id: result.lastInsertRowid as number,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    } catch (error) {
        return { status: 'fail', message: error as string }
    }
}
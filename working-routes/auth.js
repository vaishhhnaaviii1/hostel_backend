/**
 * auth.js — working-routes/auth.js
 * ============================================================
 * Authentication routes using the new schema.
 *
 * ROLES & TABLES:
 *   student   → students table  (email + password_hash)
 *   admin     → admins table    (email + password_hash)
 *     authority_level: 1 = Warden/Super Admin
 *                      2 = MMCA / Office Admin
 *                      3 = Attendant
 *                      4 = Guard
 *
 * NOTE: Passwords are stored plaintext in the password_hash
 *       column to maintain backward compatibility.
 *       Replace with bcrypt when ready.
 * ============================================================
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import pool from '../src/db/db.js';
import auth from '../src/middleware/middleware.js';
import dotenv from 'dotenv';
dotenv.config();

const router = express.Router();

// ============================================================
// HELPER: authority_level label
// ============================================================
function getAuthorityLabel(level) {
    switch (level) {
        case 1: return 'warden';
        case 2: return 'mmca';
        case 3: return 'attendant';
        case 4: return 'guard';
        default: return 'admin';
    }
}

// ============================================================
// POST /auth/login
// Body: { email, password, role: 'student' | 'admin' }
// ============================================================
router.post('/login', async (req, res) => {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
        return res.status(400).json({ message: 'Email, password and role are required' });
    }

    if (role !== 'student' && role !== 'admin') {
        return res.status(400).json({ message: 'Invalid role. Must be "student" or "admin"' });
    }

    try {
        const tableName = role === 'student' ? 'students' : 'admins';

        const result = await pool.query(
            `SELECT * FROM ${tableName} WHERE email = $1 AND password_hash = $2 LIMIT 1`,
            [email, password]
        );

        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Build JWT payload
        const payload = {
            id: user.id,
            email: user.email,
            role,
        };

        if (role === 'admin') {
            payload.authority_level = user.authority_level;
            payload.authority_label = getAuthorityLabel(user.authority_level);
        }

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' });

        // Strip sensitive fields from response
        const { password_hash, ...safeUser } = user;

        return res.status(200).json({
            message: 'Login successful',
            user: safeUser,
            token,
            role,
            ...(role === 'admin' && { authority_level: user.authority_level }),
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// ============================================================
// GET /auth/login
// Validate token from Authorization header
// ============================================================
router.get('/login', (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : req.headers.token;
    const { role } = req.headers;

    if (!token || !role) {
        return res.status(400).json({ message: 'Token and role are required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded.role !== role) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        return res.status(200).json({ message: 'Token is valid', user: decoded });
    } catch (err) {
        return res.status(401).json({ message: 'Invalid token' });
    }
});

// ============================================================
// GET /auth/me
// Returns current user info from the correct table
// ============================================================
router.get('/me', auth, async (req, res) => {
    const { id, email, role } = req.user;

    const tableName = role === 'student' ? 'students' : 'admins';

    try {
        const result = await pool.query(
            `SELECT * FROM ${tableName} WHERE id = $1 AND email = $2 LIMIT 1`,
            [id, email]
        );

        const user = result.rows[0];

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const { password_hash, ...safeUser } = user;

        return res.status(200).json({ user: safeUser, role });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// ============================================================
// POST /auth/signup
// Body for student: { role: 'student', name, email, password,
//                     roll_no, department, semester,
//                     student_number, parent_number,
//                     father_name, category, blood_group,
//                     state, address, pincode }
// Body for admin:   { role: 'admin', name, email, password,
//                     authority_level }
// ============================================================
router.post('/signup', async (req, res) => {
    const data = req.body;

    if (!data || !data.role) {
        return res.status(400).json({ message: 'Role is required' });
    }

    try {
        let result;
        let user;

        if (data.role === 'student') {
            const { name, email, password, roll_no } = data;

            if (!name || !email || !password || !roll_no) {
                return res.status(400).json({
                    message: 'Missing required fields: name, email, password, roll_no'
                });
            }

            result = await pool.query(
                `INSERT INTO students (name, email, password_hash, roll_no)
                 VALUES ($1, $2, $3, $4)
                 RETURNING *`,
                [name, email, password, roll_no]
            );
            user = result.rows[0];

        } else if (data.role === 'admin') {
            const { name, email, password, authority_level } = data;

            if (!name || !email || !password || !authority_level) {
                return res.status(400).json({
                    message: 'Missing required fields: name, email, password, authority_level'
                });
            }

            const level = parseInt(authority_level);
            if (![1, 2, 3, 4].includes(level)) {
                return res.status(400).json({
                    message: 'authority_level must be 1 (warden), 2 (mmca), 3 (attendant), or 4 (guard)'
                });
            }

            result = await pool.query(
                `INSERT INTO admins (name, email, password_hash, authority_level)
                 VALUES ($1, $2, $3, $4)
                 RETURNING *`,
                [name, email, password, level]
            );
            user = result.rows[0];

        } else {
            return res.status(400).json({ message: 'Invalid role. Must be "student" or "admin"' });
        }

        const payload = {
            id: user.id,
            email: user.email,
            role: data.role,
        };

        if (data.role === 'admin') {
            payload.authority_level = user.authority_level;
            payload.authority_label = getAuthorityLabel(user.authority_level);
        }

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' });

        const { password_hash, ...safeUser } = user;

        return res.status(201).json({ message: 'User created successfully', user: safeUser, token });

    } catch (err) {
        console.error(err);

        if (err.code === '23505') {
            return res.status(409).json({ message: 'A user with this email or roll number already exists.' });
        }

        return res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
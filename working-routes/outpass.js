/**
 * outpass.js — working-routes/outpass.js
 * ============================================================
 * Outpass routes using the new schema.
 *
 * TABLE: outpasses (base schema + extensions)
 * Columns:
 *   id, student_id, outpass_type ('Local'|'Outstation'),
 *   place_of_visit, purpose, application_date,
 *   departure_datetime, arrival_datetime, parent_contact,
 *   is_active, outp_status ('Pending'|'Approved'|'Rejected'),
 *   std_status ('In'|'Out'),
 *   created_at, updated_at,
 *   hostel_id (FK→hostels), room_id (FK→rooms)
 *
 * ROLES:
 *   student (role='student')        → apply, view own
 *   attendant (authority_level=3)   → approve/reject
 *   guard (authority_level=4)       → record exit/entry
 *   warden/mmca (level 1-2)         → full access
 *
 * EXIT/ENTRY tracking via visit_logs table.
 * ============================================================
 */

import express from 'express';
import pool from '../src/db/db.js';
import auth from '../src/middleware/middleware.js';

const router = express.Router();

// ============================================================
// POST /outpass/apply
// Student applies for outpass
// Body: { outpass_type, place_of_visit?, purpose?,
//         departure_datetime, arrival_datetime?,
//         parent_contact, hostel_id?, room_id? }
// ============================================================
router.post('/apply', auth, async (req, res) => {
    const {
        outpass_type, place_of_visit, purpose,
        departure_datetime, arrival_datetime,
        parent_contact, hostel_id, room_id,
    } = req.body;
    const { id: student_id } = req.user;

    if (!outpass_type || !departure_datetime || !parent_contact) {
        return res.status(400).json({ message: 'outpass_type, departure_datetime, and parent_contact are required' });
    }

    if (!['Local', 'Outstation'].includes(outpass_type)) {
        return res.status(400).json({ message: 'outpass_type must be "Local" or "Outstation"' });
    }

    if (outpass_type === 'Outstation' && (!place_of_visit || !purpose)) {
        return res.status(400).json({ message: 'place_of_visit and purpose are required for Outstation outpass' });
    }

    try {
        // Check for existing active outpass
        const existing = await pool.query(
            `SELECT id FROM outpasses
             WHERE student_id = $1 AND is_active = true AND outp_status IN ('Pending', 'Approved')`,
            [student_id]
        );

        if (existing.rows.length > 0) {
            return res.status(400).json({ message: 'You already have an active outpass request' });
        }

        const result = await pool.query(
            `INSERT INTO outpasses
                (student_id, outpass_type, place_of_visit, purpose,
                 departure_datetime, arrival_datetime, parent_contact,
                 hostel_id, room_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             RETURNING *`,
            [
                student_id, outpass_type,
                place_of_visit || null, purpose || null,
                departure_datetime, arrival_datetime || null,
                parent_contact,
                hostel_id || null, room_id || null,
            ]
        );

        return res.status(201).json({ message: 'Outpass application submitted successfully', outpass: result.rows[0] });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// ============================================================
// GET /outpass/my-outpasses
// Student views their own outpasses
// ============================================================
router.get('/my-outpasses', auth, async (req, res) => {
    const { id: student_id } = req.user;

    try {
        const outpasses = await pool.query(
            `SELECT o.*, h.name AS hostel_name, r.room_number
             FROM outpasses o
             LEFT JOIN hostels h ON o.hostel_id = h.id
             LEFT JOIN rooms r   ON o.room_id   = r.id
             WHERE o.student_id = $1
             ORDER BY o.created_at DESC`,
            [student_id]
        );
        return res.status(200).json({ outpasses: outpasses.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// ============================================================
// GET /outpass/by-hostel?hostel_id=<uuid>&status=Pending
// Attendant/admin views outpasses for a hostel
// ============================================================
router.get('/by-hostel', auth, async (req, res) => {
    const { hostel_id, status } = req.query;

    if (!hostel_id) {
        return res.status(400).json({ message: 'hostel_id query parameter is required' });
    }

    const filterStatus = status || 'Pending';

    try {
        const outpasses = await pool.query(
            `SELECT o.*, s.name AS student_name, s.roll_no, s.student_number AS student_phone,
                    h.name AS hostel_name, r.room_number
             FROM outpasses o
             JOIN students s ON o.student_id = s.id
             LEFT JOIN hostels h ON o.hostel_id = h.id
             LEFT JOIN rooms r   ON o.room_id   = r.id
             WHERE o.hostel_id = $1 AND o.outp_status = $2
             ORDER BY o.created_at DESC`,
            [hostel_id, filterStatus]
        );
        return res.status(200).json({ outpasses: outpasses.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// ============================================================
// GET /outpass/all-approved
// View all approved outpasses (guard/admin)
// ============================================================
router.get('/all-approved', auth, async (req, res) => {
    try {
        const outpasses = await pool.query(
            `SELECT o.*, s.name AS student_name, s.roll_no, s.department,
                    s.student_number AS student_phone,
                    h.name AS hostel_name, r.room_number
             FROM outpasses o
             JOIN students s ON o.student_id = s.id
             LEFT JOIN hostels h ON o.hostel_id = h.id
             LEFT JOIN rooms r   ON o.room_id   = r.id
             WHERE o.outp_status = 'Approved'
             ORDER BY o.hostel_id, o.created_at DESC`
        );
        return res.status(200).json({ outpasses: outpasses.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// ============================================================
// GET /outpass/approved-by-hostel?hostel_id=<uuid>
// View approved outpasses for a hostel (guard)
// ============================================================
router.get('/approved-by-hostel', auth, async (req, res) => {
    const { hostel_id } = req.query;

    if (!hostel_id) {
        return res.status(400).json({ message: 'hostel_id query parameter is required' });
    }

    try {
        const outpasses = await pool.query(
            `SELECT o.*, s.name AS student_name, s.roll_no, s.student_number AS student_phone,
                    h.name AS hostel_name, r.room_number
             FROM outpasses o
             JOIN students s ON o.student_id = s.id
             LEFT JOIN hostels h ON o.hostel_id = h.id
             LEFT JOIN rooms r   ON o.room_id   = r.id
             WHERE o.hostel_id = $1 AND o.outp_status = 'Approved'
             ORDER BY o.created_at DESC`,
            [hostel_id]
        );
        return res.status(200).json({ outpasses: outpasses.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// ============================================================
// PUT /outpass/update-outpass
// Attendant approves or rejects a pending outpass
// Body: { outpass_id, status: 'Approved'|'Rejected' }
// ============================================================
router.put('/update-outpass', auth, async (req, res) => {
    const { outpass_id, status } = req.body;

    if (!outpass_id || !status) {
        return res.status(400).json({ message: 'outpass_id and status are required' });
    }

    if (!['Approved', 'Rejected'].includes(status)) {
        return res.status(400).json({ message: 'status must be "Approved" or "Rejected"' });
    }

    try {
        const isActive = status === 'Approved';

        const result = await pool.query(
            `UPDATE outpasses
             SET outp_status = $1,
                 is_active   = $2,
                 updated_at  = NOW()
             WHERE id = $3 AND outp_status = 'Pending'
             RETURNING *`,
            [status, isActive, outpass_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Outpass not found or not in pending status' });
        }

        return res.status(200).json({ message: 'Outpass updated successfully', outpass: result.rows[0] });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// ============================================================
// PUT /outpass/record-entry
// Guard records student exit or entry
// Body: { outpass_id, action: 'exit'|'enter' }
//
// EXIT:  creates visit_log, sets std_status = 'Out'
// ENTER: updates visit_log actual_arrival, sets std_status = 'In',
//        is_active = false
// ============================================================
router.put('/record-entry', auth, async (req, res) => {
    const { outpass_id, action } = req.body;

    if (!outpass_id || !action) {
        return res.status(400).json({ message: 'outpass_id and action (exit/enter) are required' });
    }

    if (action !== 'exit' && action !== 'enter') {
        return res.status(400).json({ message: 'action must be "exit" or "enter"' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Fetch outpass
        const outpassRes = await client.query(
            `SELECT * FROM outpasses WHERE id = $1`,
            [outpass_id]
        );

        if (outpassRes.rows.length === 0) {
            throw Object.assign(new Error('Outpass not found'), { statusCode: 404 });
        }

        const outpass = outpassRes.rows[0];

        if (outpass.outp_status !== 'Approved') {
            throw Object.assign(new Error('Outpass is not approved'), { statusCode: 400 });
        }

        if (action === 'exit') {
            if (outpass.std_status === 'Out') {
                throw Object.assign(new Error('Student is already outside'), { statusCode: 400 });
            }

            // Create visit log entry
            await client.query(
                `INSERT INTO visit_logs (outpass_id, student_id) VALUES ($1, $2)`,
                [outpass.id, outpass.student_id]
            );

            // Mark student as Out
            await client.query(
                `UPDATE outpasses SET std_status = 'Out', updated_at = NOW() WHERE id = $1`,
                [outpass.id]
            );

        } else {
            // action === 'enter'
            if (outpass.std_status !== 'Out') {
                throw Object.assign(new Error('Student is not currently outside'), { statusCode: 400 });
            }

            // Update visit log with arrival time
            await client.query(
                `UPDATE visit_logs
                 SET actual_arrival = NOW(), updated_at = NOW()
                 WHERE outpass_id = $1 AND student_id = $2`,
                [outpass.id, outpass.student_id]
            );

            // Mark student as In + close outpass
            await client.query(
                `UPDATE outpasses
                 SET std_status = 'In', is_active = false, updated_at = NOW()
                 WHERE id = $1`,
                [outpass.id]
            );
        }

        await client.query('COMMIT');

        return res.status(200).json({
            message: `Outpass marked as ${action === 'exit' ? 'exited' : 'entered'}`,
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        return res.status(err.statusCode || 500).json({ message: err.message || 'Internal server error' });
    } finally {
        client.release();
    }
});

// ============================================================
// GET /outpass/monitor
// Full outpass list for monitoring dashboard (no auth req.)
// ============================================================
router.get('/monitor', async (req, res) => {
    try {
        const outpasses = await pool.query(
            `SELECT o.*, s.name AS student_name, s.roll_no, s.department,
                    s.student_number AS student_phone,
                    h.name AS hostel_name, r.room_number
             FROM outpasses o
             JOIN students s ON o.student_id = s.id
             LEFT JOIN hostels h ON o.hostel_id = h.id
             LEFT JOIN rooms r   ON o.room_id   = r.id
             ORDER BY o.created_at DESC`
        );
        return res.status(200).json({ outpasses: outpasses.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
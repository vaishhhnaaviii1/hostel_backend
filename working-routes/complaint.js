/**
 * complaint.js — working-routes/complaint.js
 * Updated for new schema: complaints table with extensions.
 */

import express from 'express';
import pool from '../src/db/db.js';
import auth from '../src/middleware/middleware.js';

const router = express.Router();

// POST /complaint/postcomplaint
router.post('/postcomplaint', auth, async (req, res) => {
    const { title, description, hostel_id, category, image_url } = req.body;
    const { id: student_id } = req.user;

    if (!description) {
        return res.status(400).json({ message: 'description is required' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO complaints (student_id, title, description, hostel_id, category, image_url)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [student_id, title || 'Untitled', description, hostel_id || null, category || null, image_url || null]
        );
        return res.status(201).json({ message: 'Complaint submitted successfully', complaint: result.rows[0] });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /complaint/my-complaints
router.get('/my-complaints', auth, async (req, res) => {
    const { id: student_id } = req.user;

    try {
        const complaints = await pool.query(
            `SELECT c.*, h.name AS hostel_name, a.name AS resolved_by_name
             FROM complaints c
             LEFT JOIN hostels h ON c.hostel_id = h.id
             LEFT JOIN admins a ON c.resolved_by = a.id
             WHERE c.student_id = $1
             ORDER BY c.created_at DESC`,
            [student_id]
        );
        return res.status(200).json({ complaints: complaints.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /complaint/by-hostel?hostel_id=<uuid>&status=Pending
router.get('/by-hostel', auth, async (req, res) => {
    const { hostel_id, status } = req.query;

    if (!hostel_id) {
        return res.status(400).json({ message: 'hostel_id query parameter is required' });
    }

    const filterStatus = status || 'Pending';

    try {
        const complaints = await pool.query(
            `SELECT c.*, s.name AS student_name, s.roll_no, s.student_number AS student_phone,
                    h.name AS hostel_name, a.name AS resolved_by_name
             FROM complaints c
             JOIN students s ON c.student_id = s.id
             LEFT JOIN hostels h ON c.hostel_id = h.id
             LEFT JOIN admins a ON c.resolved_by = a.id
             WHERE c.hostel_id = $1 AND c.status = $2
             ORDER BY c.created_at DESC`,
            [hostel_id, filterStatus]
        );
        return res.status(200).json({ complaints: complaints.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /complaint/all?status=Pending
router.get('/all', auth, async (req, res) => {
    const { status } = req.query;

    try {
        const values = [];
        let whereClause = '';
        if (status) {
            values.push(status);
            whereClause = `WHERE c.status = $1`;
        }

        const complaints = await pool.query(
            `SELECT c.*, s.name AS student_name, s.roll_no, h.name AS hostel_name, a.name AS resolved_by_name
             FROM complaints c
             JOIN students s ON c.student_id = s.id
             LEFT JOIN hostels h ON c.hostel_id = h.id
             LEFT JOIN admins a ON c.resolved_by = a.id
             ${whereClause}
             ORDER BY c.created_at DESC`,
            values
        );
        return res.status(200).json({ complaints: complaints.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /complaint/update-complaint
// Body: { complaint_id, status, resolved_description? }
router.put('/update-complaint', auth, async (req, res) => {
    const { complaint_id, status, resolved_description } = req.body;
    const { id: admin_id } = req.user;

    if (!complaint_id || !status) {
        return res.status(400).json({ message: 'complaint_id and status are required' });
    }

    const validStatuses = ['Pending', 'In Progress', 'Resolved'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: `status must be one of: ${validStatuses.join(', ')}` });
    }

    try {
        let query, params;

        if (status === 'Resolved') {
            query = `UPDATE complaints
                     SET status = $1, resolved_by = $2, resolved_at = NOW(),
                         resolved_description = $3, updated_at = NOW()
                     WHERE id = $4 AND status != 'Resolved'
                     RETURNING *`;
            params = [status, admin_id, resolved_description || null, complaint_id];
        } else {
            query = `UPDATE complaints SET status = $1, updated_at = NOW()
                     WHERE id = $2 AND status != 'Resolved' RETURNING *`;
            params = [status, complaint_id];
        }

        const result = await pool.query(query, params);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Complaint not found or already resolved' });
        }

        return res.status(200).json({ message: 'Complaint updated successfully', complaint: result.rows[0] });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /complaint/upvote
// Body: { complaint_id }
router.put('/upvote', auth, async (req, res) => {
    const { complaint_id } = req.body;

    if (!complaint_id) {
        return res.status(400).json({ message: 'complaint_id is required' });
    }

    try {
        const result = await pool.query(
            `UPDATE complaints SET upvotes = upvotes + 1
             WHERE id = $1 AND status = 'Pending' RETURNING *`,
            [complaint_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Complaint not found or already resolved' });
        }

        return res.status(200).json({ message: 'Upvoted successfully', complaint: result.rows[0] });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;
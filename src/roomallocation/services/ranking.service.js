import pool from '../../db/pool.js';
import ApiError from '../../utils/apiError.js';

/**
 * Assign or update individual rank for a student
 */
export const updateIndividualRank = async (studentId, rank) => {
    try {
        const result = await pool.query(
            `UPDATE students SET individual_rank = $1 WHERE id = $2 RETURNING *`,
            [rank, studentId]
        );
        if (result.rows.length === 0) throw new ApiError(404, 'Student not found');
        return result.rows[0];
    } catch (error) {
        if (error.code === '23505') { // Unique violation
            throw new ApiError(400, `Rank ${rank} is already assigned to another student`);
        }
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, 'Error updating individual rank: ' + error.message);
    }
};

/**
 * Calculate and set overall group ranks for a batch
 * Calculates the average of member ranks and updates the housing_group group_rank
 * Note: Assumes lower number = better rank
 */
export const calculateAndSetGroupRanks = async (batchId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Fetch groups in the batch
        const groupsRes = await client.query(
            `SELECT id FROM housing_groups WHERE batch_id = $1`,
            [batchId]
        );

        if (groupsRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return { message: 'No groups found in this batch' };
        }

        const groupsToUpdate = [];

        for (const group of groupsRes.rows) {
            // Get members for the group
            const membersRes = await client.query(
                `SELECT individual_rank FROM students WHERE group_id = $1`,
                [group.id]
            );

            const members = membersRes.rows;
            if (members.length === 0) continue;

            // Simple average calculation. Missing ranks are ignored or treated as heavily penalized depending on business logic.
            // Assuming all students in batch must have ranks for fairness.
            let totalRank = 0;
            let validRanks = 0;

            for (const member of members) {
                if (member.individual_rank !== null) {
                    totalRank += member.individual_rank;
                    validRanks++;
                }
            }

            const averageRank = validRanks > 0 ? Math.floor(totalRank / validRanks) : 999999; // Fallback for unranked groups
            
            groupsToUpdate.push({
                groupId: group.id,
                rank: averageRank
            });
        }

        // Sort groups by their calculated average rank to determine the final sequential group rank
        // If average ranks are equal, rollover groups should get priority. For simplicity here, just sort by average.
        groupsToUpdate.sort((a, b) => a.rank - b.rank);

        // Assign final group ranks sequentially (1, 2, 3...)
        let currentRank = 1;
        for (const g of groupsToUpdate) {
            await client.query(
                `UPDATE housing_groups SET group_rank = $1 WHERE id = $2`,
                [currentRank, g.groupId]
            );
            currentRank++;
        }

        await client.query('COMMIT');
        return { success: true, message: `Ranked ${groupsToUpdate.length} groups successfully.` };
    } catch (error) {
        await client.query('ROLLBACK');
        throw new ApiError(500, 'Error calculating group ranks: ' + error.message);
    } finally {
        client.release();
    }
};

/**
 * Fetch top N unranked students to potentially assign ranks
 */
export const getUnrankedStudents = async (limit = 100) => {
    try {
        const result = await pool.query(
            `SELECT id, name, roll_no, cgpa 
             FROM students 
             WHERE individual_rank IS NULL 
             ORDER BY cgpa DESC NULLS LAST 
             LIMIT $1`,
            [limit]
        );
        return result.rows;
    } catch (error) {
        throw new ApiError(500, 'Error fetching unranked students: ' + error.message);
    }
};

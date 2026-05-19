import {
    createGroupService,
    inviteStudentService,
    acceptInviteService
} from "./groups.service.js";

/*
=================================================
CREATE GROUP CONTROLLER
=================================================
*/

export const createGroupController =
async (req, res) => {

    try {

        const { leaderId } =
            req.body;

        const result =
            await createGroupService(
                leaderId
            );

        res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};

/*
=================================================
INVITE STUDENT CONTROLLER
=================================================
*/

export const inviteStudentController =
async (req, res) => {

    try {

        const {
            groupId,
            studentId
        } = req.body;

        const result =
            await inviteStudentService(
                groupId,
                studentId
            );

        res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};

/*
=================================================
ACCEPT INVITE CONTROLLER
=================================================
*/

export const acceptInviteController =
async (req, res) => {

    try {

        const {
            requestId
        } = req.body;

        const result =
            await acceptInviteService(
                requestId
            );

        res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};
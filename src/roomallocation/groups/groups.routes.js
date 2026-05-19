import express from "express";

import {
    createGroupController,
    inviteStudentController,
    acceptInviteController
} from "./groups.controller.js";

const router = express.Router();

/*
=================================================
CREATE GROUP
=================================================
*/

router.post(
    "/create",
    createGroupController
);

/*
=================================================
INVITE STUDENT
=================================================
*/

router.post(
    "/invite",
    inviteStudentController
);

/*
=================================================
ACCEPT INVITE
=================================================
*/

router.post(
    "/accept-invite",
    acceptInviteController
);

export default router;
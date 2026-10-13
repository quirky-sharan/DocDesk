const express = require('express');
const auth = require('../controllers/auth');
const { allow } = require('../middleware/authenticate');
const { signInAttempts } = require('../middleware/rateLimit');

const router = express.Router();

// The first two are public (see middleware/authenticate.js): asking who you
// are, and signing in, are the two things that cannot require being signed in.
router.get('/auth/session', auth.session);
router.post('/auth/session', signInAttempts, auth.signIn);
router.delete('/auth/session', auth.signOut);

// Who may use DocDesk, and as what. The owner's alone.
router.get('/team', allow('owner'), auth.team);
router.put('/team/:id', allow('owner'), auth.updateMember);
router.delete('/team/:id', allow('owner'), auth.removeMember);
router.post('/team/:id/sign-out', allow('owner'), auth.signOutMember);

module.exports = router;

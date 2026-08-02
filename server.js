const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Essential for allowing the frontend buttons to send data to the backend
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------- DATABASE SETUP ---------- //
const DB_FILE = path.join(__dirname, 'database.json');

function readDB() {
    try {
        if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE));
    } catch (err) { console.error("DB Read Error:", err); }
    return { users: {} };
}

function writeDB(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (err) { console.error("DB Write Error:", err); }
}

// ---------- DISCORD SETTINGS ---------- //
const DISCORD_CLIENT_ID = '1532988574583226538';
const DISCORD_CLIENT_SECRET = 'qSX44vleIXgec44EU24bfuimfolc8Ron';
const CALLBACK_URL = 'https://polar-dashboard-1.onrender.com/auth/discord/callback';
const YOUR_GUILD_ID = '1507403006357016698'; 

// ---------- ROBLOX SETTINGS ---------- //
const ROBLOX_CLIENT_ID = '4032802800945626524';
const ROBLOX_CLIENT_SECRET = 'RBX-GXSknhrb20GM9wncCxR_4IQa3a85Nc4dWeApOTjgZ7XORf5uAad-fN101SFfp_7F';
const ROBLOX_REDIRECT_URI = 'https://polar-dashboard-1.onrender.com/auth/roblox/callback';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

app.use(session({
    secret: 'polar-secure-session',
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

// ---------- LOAD SAVED ROBLOX DATA ---------- //
app.use((req, res, next) => {
    if (req.isAuthenticated() && !req.session.robloxData) {
        const db = readDB();
        if (db.users[req.user.profile.id] && db.users[req.user.profile.id].roblox) {
            req.session.robloxData = db.users[req.user.profile.id].roblox;
        }
    }
    next();
});

passport.use(new DiscordStrategy({
    clientID: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    callbackURL: CALLBACK_URL,
    scope: ['identify', 'guilds', 'guilds.members.read']
}, async (accessToken, refreshToken, profile, done) => {
    return done(null, { profile, accessToken });
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// ---------- ROUTES ---------- //

app.get('/', (req, res) => {
    if (req.isAuthenticated()) return res.redirect('/dashboard');
    res.redirect('/login');
});

app.get('/login', (req, res) => {
    res.render('login');
});

// DISCORD AUTH ROUTES
app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback', passport.authenticate('discord', {
    failureRedirect: '/login'
}), (req, res) => {
    // Save last visit time to the database
    const db = readDB();
    const userId = req.user.profile.id;
    if (!db.users[userId]) db.users[userId] = {};
    
    req.session.lastVisit = db.users[userId].lastVisit || Date.now();
    db.users[userId].lastVisit = Date.now();
    writeDB(db);

    res.redirect('/dashboard');
});

// ROBLOX AUTH ROUTES
app.get('/auth/roblox', (req, res) => {
    const redirect = encodeURIComponent(ROBLOX_REDIRECT_URI);
    const robloxAuthUrl = `https://apis.roblox.com/oauth/v1/authorize?client_id=${ROBLOX_CLIENT_ID}&redirect_uri=${redirect}&scope=openid profile&response_type=code`;
    res.redirect(robloxAuthUrl);
});

app.get('/auth/roblox/callback', async (req, res) => {
    const { code } = req.query;
    const userProfile = req.user ? req.user.profile : null;
    const avatarUrl = userProfile ? `https://cdn.discordapp.com/avatars/${userProfile.id}/${userProfile.avatar}.png` : '';

    if (!code) {
        return res.render('status', { 
            status: 'error', title: 'Link Failed', message: 'No authorization code provided. Please start again.', 
            user: userProfile, avatarUrl: avatarUrl, roblox: null 
        });
    }

    try {
        const params = new URLSearchParams();
        params.append('client_id', ROBLOX_CLIENT_ID);
        params.append('client_secret', ROBLOX_CLIENT_SECRET);
        params.append('grant_type', 'authorization_code');
        params.append('code', code);

        const tokenRes = await axios.post('https://apis.roblox.com/oauth/v1/token', params.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const userRes = await axios.get('https://apis.roblox.com/oauth/v1/userinfo', {
            headers: { 'Authorization': `Bearer ${tokenRes.data.access_token}` }
        });

        const robloxId = userRes.data.sub;
        let robloxAvatarUrl = 'https://judahcustoms.org/assets/Emojis/roblox.png';
        
        try {
            const thumbRes = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxId}&size=150x150&format=Png&isCircular=true`);
            if (thumbRes.data && thumbRes.data.data && thumbRes.data.data.length > 0) {
                robloxAvatarUrl = thumbRes.data.data[0].imageUrl;
            }
        } catch (err) {}

        const formattedDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

        req.session.robloxData = {
            username: userRes.data.preferred_username,
            displayName: userRes.data.nickname || userRes.data.preferred_username,
            id: robloxId,
            avatarUrl: robloxAvatarUrl,
            verifiedAt: formattedDate,
            updatedAt: formattedDate
        };

        // Save to Database so it persists across logouts
        const db = readDB();
        if (!db.users[userProfile.id]) db.users[userProfile.id] = {};
        db.users[userProfile.id].roblox = req.session.robloxData;
        writeDB(db);

        res.render('status', {
            status: 'success', title: 'Account Linked', message: 'Your Roblox account has been successfully linked to your profile.',
            user: userProfile, avatarUrl: avatarUrl, roblox: req.session.robloxData
        });
        
    } catch (err) {
        res.render('status', { 
            status: 'error', title: 'Link Expired', message: 'Your verification link expired (10 minutes). Please start again.', 
            user: userProfile, avatarUrl: avatarUrl, roblox: null 
        });
    }
});

// DASHBOARD PAGE
app.get('/dashboard', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/login');

    const user = req.user.profile;
    const accessToken = req.user.accessToken;
    let robloxData = req.session.robloxData || null;
    let joinedAt = 'Unknown';

    try {
        const guildMemberRes = await axios.get(`https://discord.com/api/users/@me/guilds/${YOUR_GUILD_ID}/member`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        joinedAt = new Date(guildMemberRes.data.joined_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (err) {}

    res.render('dashboard', {
        user: user,
        avatarUrl: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`,
        roblox: robloxData,
        createdAt: new Date(Number((BigInt(user.id) >> 22n) + 1420070400000n)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
        joinedAt: joinedAt
    });
});

// INVENTORY PAGE
app.get('/inventory', (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/login');
    res.render('inventory', {
        user: req.user.profile,
        avatarUrl: `https://cdn.discordapp.com/avatars/${req.user.profile.id}/${req.user.profile.avatar}.png`,
        roblox: req.session.robloxData || null
    });
});

app.get('/verify', (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/login');
    res.render('verify');
});

app.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        req.session.destroy(() => {
            res.redirect('/login');
        });
    });
});

// ACCOUNT MANAGEMENT ROUTES
app.post('/api/account/unlink', (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    
    // Remove from DB
    const db = readDB();
    if (db.users[req.user.profile.id]) {
        delete db.users[req.user.profile.id].roblox;
        writeDB(db);
    }

    req.session.robloxData = null;
    res.json({ ok: true });
});

app.post('/api/account/refresh', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    if (req.session.robloxData) {
        try {
            const thumbRes = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${req.session.robloxData.id}&size=150x150&format=Png&isCircular=true`);
            if (thumbRes.data && thumbRes.data.data && thumbRes.data.data.length > 0) {
                req.session.robloxData.avatarUrl = thumbRes.data.data[0].imageUrl;
            }
        } catch (err) {}
        req.session.robloxData.updatedAt = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        
        // Update DB
        const db = readDB();
        if (db.users[req.user.profile.id]) {
            db.users[req.user.profile.id].roblox = req.session.robloxData;
            writeDB(db);
        }
    }
    res.json({ ok: true });
});

// API STUBS FOR FRONTEND UI SCRIPTS
app.get('/api/dash/state', (req, res) => {
    if (!req.isAuthenticated()) return res.json({ ok: false });
    const db = readDB();
    const userDb = db.users[req.user.profile.id] || {};
    res.json({ 
        ok: true, 
        lastSeenAt: req.session.lastVisit,
        tourSeen: userDb.tourSeen === true
    });
});

app.post('/api/dash/tour-done', (req, res) => {
    if (!req.isAuthenticated()) return res.json({ ok: false });
    const db = readDB();
    if (!db.users[req.user.profile.id]) db.users[req.user.profile.id] = {};
    db.users[req.user.profile.id].tourSeen = true;
    writeDB(db);
    res.json({ ok: true });
});

app.get('/api/banner', (req, res) => res.json({ banners: [] }));
app.get('/api/cart/count', (req, res) => res.json({ count: 0 }));
app.get('/api/credits/balance', (req, res) => res.json({ balance: 0 }));
app.get('/api/messages/unread-count', (req, res) => res.json({ count: 0 }));
app.get('/api/achievements/unseen', (req, res) => res.json({ list: [] }));
app.post('/api/log/click', (req, res) => res.json({ ok: true }));
app.get('/api/session/heartbeat', (req, res) => res.json({ ok: true }));

app.get('/:page', (req, res, next) => {
    if (!req.isAuthenticated()) return res.redirect('/login');
    if (req.params.page.startsWith('auth')) return next();
    
    res.send(`
        <body style="background-color: #060e1a; color: white; font-family: sans-serif; text-align: center; padding-top: 100px;">
            <h1 style="color: #00FF00;">Coming Soon</h1>
            <p>The /${req.params.page} page is currently under construction.</p>
            <br><br>
            <a href="/dashboard" style="color: #bb86fc; text-decoration: none; font-weight: bold; background: #111d33; padding: 10px 20px; border-radius: 8px;">← Go back to Dashboard</a>
        </body>
    `);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

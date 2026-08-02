const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

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
    res.render('login');
});

// DISCORD AUTH ROUTES
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', {
    failureRedirect: '/'
}), (req, res) => res.redirect('/dashboard'));

// ROBLOX AUTH ROUTES
app.get('/auth/roblox', (req, res) => {
    const redirect = encodeURIComponent(ROBLOX_REDIRECT_URI);
    const robloxAuthUrl = `https://apis.roblox.com/oauth/v1/authorize?client_id=${ROBLOX_CLIENT_ID}&redirect_uri=${redirect}&scope=openid profile&response_type=code`;
    res.redirect(robloxAuthUrl);
});

app.get('/auth/roblox/callback', async (req, res) => {
    const { code } = req.query;
    
    // Safely get user info to display on the success page
    const userProfile = req.user ? req.user.profile : null;
    const avatarUrl = userProfile ? `https://cdn.discordapp.com/avatars/${userProfile.id}/${userProfile.avatar}.png` : '';

    if (!code) {
        return res.render('status', { 
            status: 'error', 
            title: 'Link Failed', 
            message: 'No authorization code provided. Please start again.', 
            user: userProfile, 
            avatarUrl: avatarUrl, 
            roblox: null 
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

        // Format the date exactly like "2 August 2026"
        const formattedDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

        req.session.robloxData = {
            username: userRes.data.preferred_username,
            displayName: userRes.data.nickname || userRes.data.preferred_username,
            id: userRes.data.sub,
            verifiedAt: formattedDate,
            updatedAt: formattedDate
        };

        // Render the Success Page!
        res.render('status', {
            status: 'success',
            title: 'Account Linked',
            message: 'Your Roblox account has been successfully linked to your profile.',
            user: userProfile,
            avatarUrl: avatarUrl,
            roblox: req.session.robloxData
        });
        
    } catch (err) {
        console.log("Roblox Auth Error:", err.response ? err.response.data : err.message);
        res.render('status', { 
            status: 'error', 
            title: 'Link Expired', 
            message: 'Your verification link expired (10 minutes). Please start again.', 
            user: userProfile, 
            avatarUrl: avatarUrl, 
            roblox: null 
        });
    }
});

// DASHBOARD PAGE
app.get('/dashboard', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/');

    const user = req.user.profile;
    const accessToken = req.user.accessToken;
    let robloxData = req.session.robloxData || null;
    let joinedAt = 'Unknown';

    try {
        const guildMemberRes = await axios.get(`https://discord.com/api/users/@me/guilds/${YOUR_GUILD_ID}/member`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        joinedAt = new Date(guildMemberRes.data.joined_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (err) {
        console.log("Could not fetch Discord guild data");
    }

    res.render('dashboard', {
        user: user,
        avatarUrl: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`,
        roblox: robloxData,
        createdAt: new Date(Number((BigInt(user.id) >> 22n) + 1420070400000n)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
        joinedAt: joinedAt,
        lastVisit: new Date().toLocaleTimeString()
    });
});

// INVENTORY PAGE
app.get('/inventory', (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/');

    const user = req.user.profile;
    const robloxData = req.session.robloxData || null;

    res.render('inventory', {
        user: user,
        avatarUrl: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`,
        roblox: robloxData
    });
});

app.get('/verify', (req, res) => {
    res.render('verify');
});

app.get('/logout', (req, res, next) => {
    req.session.destroy();
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/');
    });
});

// ACCOUNT MANAGEMENT ROUTES (Added for Unlink/Refresh buttons)
app.post('/api/account/unlink', (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    req.session.robloxData = null; // Deletes the Roblox data from the session
    res.json({ ok: true });
});

app.post('/api/account/refresh', (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    if (req.session.robloxData) {
        // Update the timestamp when they click Refresh
        req.session.robloxData.updatedAt = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    res.json({ ok: true });
});

app.get('/:page', (req, res, next) => {
    if (!req.isAuthenticated()) return res.redirect('/');
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

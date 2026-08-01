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
// Paste your new Roblox Client ID and Secret inside these quotes!
const ROBLOX_CLIENT_ID = 'YOUR_ROBLOX_CLIENT_ID';
const ROBLOX_CLIENT_SECRET = 'YOUR_ROBLOX_CLIENT_SECRET';
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

// Set up Discord OAuth2
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
    if (!code) return res.redirect('/verify');

    try {
        // 1. Exchange the code for an Access Token
        const params = new URLSearchParams();
        params.append('client_id', ROBLOX_CLIENT_ID);
        params.append('client_secret', ROBLOX_CLIENT_SECRET);
        params.append('grant_type', 'authorization_code');
        params.append('code', code);

        const tokenRes = await axios.post('https://apis.roblox.com/oauth/v1/token', params.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        // 2. Use the Access Token to get the user's real Roblox Profile
        const userRes = await axios.get('https://apis.roblox.com/oauth/v1/userinfo', {
            headers: { 'Authorization': `Bearer ${tokenRes.data.access_token}` }
        });

        // 3. Save it to their session memory
        req.session.robloxData = {
            username: userRes.data.preferred_username,
            displayName: userRes.data.nickname || userRes.data.preferred_username,
            id: userRes.data.sub
        };

        res.redirect('/dashboard');
    } catch (err) {
        console.log("Roblox Auth Error:", err.response ? err.response.data : err.message);
        res.redirect('/verify');
    }
});


// PAGES
app.get('/dashboard', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/');

    const user = req.user.profile;
    const accessToken = req.user.accessToken;
    
    // Check if they linked Roblox in this session!
    let robloxData = req.session.robloxData || null;
    let joinedAt = 'Unknown';

    try {
        const guildMemberRes = await axios.get(`https://discord.com/api/users/@me/guilds/${YOUR_GUILD_ID}/member`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        joinedAt = new Date(guildMemberRes.data.joined_at).toLocaleDateString();
    } catch (err) {
        console.log("Could not fetch Discord guild data");
    }

    res.render('dashboard', {
        user: user,
        avatarUrl: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`,
        roblox: robloxData,
        createdAt: new Date(Number((BigInt(user.id) >> 22n) + 1420070400000n)).toLocaleDateString(),
        joinedAt: joinedAt,
        lastVisit: new Date().toLocaleTimeString()
    });
});

app.get('/inventory', (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/');

    const user = req.user.profile;
    res.render('inventory', {
        user: user,
        avatarUrl: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
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
